import { rmSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { DRAFT_BUSY, type DraftOpenResult } from '../shared/types'
import { DraftFileError, draftParts, partialFileOf, readDraft, writeDraft } from './draft-file'
import { localFile } from './renderer-paths'

const EXTENSION = '.cawmera'
const NOT_LOCAL = 'Not a .cawmera file on a local drive'

export interface DraftHost {
  recordingsRoot: string
  newId: () => string
  takeFolder: (id: string) => string | null
  adoptTake: (id: string) => void
  /** The save dialog: the path picked, or null when cancelled. */
  chooseSaveTarget: (fileName: string) => Promise<string | null>
  /** The open dialog: the path picked, or null when cancelled. */
  chooseDraft: () => Promise<string | null>
  /** Asked when a close comes while another waits for a draft being written: true to close anyway, giving that draft up. */
  askToCloseAnyway: () => Promise<boolean>
}

type SaveResult = { path: string } | { error: string } | null

const withExtension = (path: string) => (extname(path).toLowerCase() === EXTENSION ? path : `${path}${EXTENSION}`)

const fileNameFor = (suggestedName: unknown) =>
  withExtension(typeof suggestedName === 'string' && suggestedName.trim() ? basename(suggestedName.trim()) : 'whats-new-draft')

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Electron sends a save's reply once its promise settles; a task later, the reply has gone out. */
const afterReplies = () => new Promise<void>((resolve) => setImmediate(resolve))

/** A path from the renderer must name a local .cawmera file; one the user picked in a dialog opens as picked. */
export function createDraftRequests(host: DraftHost) {
  let busy = false
  let unfinishedSave: string | null = null
  let writing: Promise<void> | null = null
  let heldClose: { givenUp: boolean } | null = null
  let askingToCloseAnyway = false

  async function oneAtATime<T>(whenBusy: T, work: () => Promise<T>): Promise<T> {
    if (busy) return whenBusy
    busy = true
    try {
      return await work()
    } finally {
      busy = false
    }
  }

  async function saveNow(files: unknown, suggestedName: unknown, onProgress: (share: number) => void): Promise<SaveResult> {
    try {
      const parts = draftParts(files, host.takeFolder)
      const picked = await host.chooseSaveTarget(fileNameFor(suggestedName))
      if (!picked) return null
      const target = withExtension(picked)
      unfinishedSave = partialFileOf(target)
      writing = writeDraft(target, parts, onProgress)
      await writing
      return { path: target }
    } catch (error) {
      return { error: messageOf(error) }
    } finally {
      unfinishedSave = null
      writing = null
    }
  }

  async function read(path: string, onProgress: (share: number) => void): Promise<DraftOpenResult> {
    const files = await readDraft(path, host.recordingsRoot, host.newId, onProgress)
    for (const { id } of files.recordings) host.adoptTake(id)
    return { ok: true, files }
  }

  async function openNow(requested: unknown, onProgress: (share: number) => void): Promise<DraftOpenResult | null> {
    try {
      if (requested === null) {
        const picked = await host.chooseDraft()
        return picked === null ? null : await read(picked, onProgress)
      }
      const path = await localFile(requested, EXTENSION)
      return path ? await read(path, onProgress) : { ok: false, reason: 'unreadable', message: NOT_LOCAL }
    } catch (error) {
      const failure = error instanceof DraftFileError ? error : new DraftFileError('unreadable', messageOf(error))
      return { ok: false, reason: failure.reason, message: failure.message }
    }
  }

  const save = (files: unknown, suggestedName: unknown, onProgress: (share: number) => void) =>
    oneAtATime<SaveResult>({ error: DRAFT_BUSY }, () => saveNow(files, suggestedName, onProgress))

  const open = (requested: unknown, onProgress: (share: number) => void) =>
    oneAtATime<DraftOpenResult | null>({ ok: false, reason: 'unreadable', message: DRAFT_BUSY }, () => openNow(requested, onProgress))

  async function offerToCloseAnyway(closeAnyway: () => void) {
    if (askingToCloseAnyway) return
    askingToCloseAnyway = true
    const giveUp = await host.askToCloseAnyway().catch(() => false)
    askingToCloseAnyway = false
    if (!giveUp || !heldClose) return
    heldClose.givenUp = true
    discardUnfinishedSave()
    closeAnyway()
  }

  /**
   * A close waits for the draft being written, so a save the user asked for is never dropped: `close` runs once, after the
   * write has ended either way and the renderer has its answer. Another close meanwhile asks whether to close anyway, in case
   * the write is stuck; giving up removes the half-written file and runs `closeAnyway`, and closes aren't held after that.
   * False when no draft is being written, or once it was given up.
   */
  function holdCloseWhileWriting(close: () => void, closeAnyway: () => void): boolean {
    if (!writing || heldClose?.givenUp) return false
    if (heldClose) {
      void offerToCloseAnyway(closeAnyway)
      return true
    }
    const hold = { givenUp: false }
    heldClose = hold
    void writing.then(afterReplies, afterReplies).then(() => {
      if (heldClose === hold) heldClose = null
      if (!hold.givenUp) close()
    })
    return true
  }

  /** For quitting mid-save: the half-written file goes, and the draft it would replace stays. */
  function discardUnfinishedSave() {
    if (!unfinishedSave) return
    try {
      rmSync(unfinishedSave, { force: true })
    } catch {
      // Best effort: Cawmera is quitting, and what's left is only a .partial file beside the draft.
    }
  }

  return { save, open, discardUnfinishedSave, holdCloseWhileWriting }
}
