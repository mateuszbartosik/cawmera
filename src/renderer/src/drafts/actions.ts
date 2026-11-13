import { toast, type ExternalToast } from 'sonner'
import { DRAFT_BUSY, type CawmeraBridge, type DiscardPurpose, type DraftFiles, type DraftOpenFailure } from '@shared/types'
import { slugify, type Doc } from '../app/doc'
import { houseStyleImported, type HouseStyle } from '../app/house-style'
import { savedFile } from '../app/save-toast'
import {
  getSource,
  liveShots,
  markDraftSaved,
  MAX_SOURCE_PIXELS,
  newId,
  registerSource,
  replaceCanvas,
  store,
  unsavedCount,
  type ShotRecord,
  type SourceEntry
} from '../app/store'
import { blobBytes, bridge } from '../platform/bridge'
import { getRecording, loadPoster, registerRecording, type RecordingEntry } from '../recording/registry'
import { parseTrack, serializeTrack, type RecordingTrack } from '../recording/track'
import type { Size } from '../render/geometry'
import { buildDraftManifest, DraftError, parseDraftManifest, type DraftContents, type DraftFailure, type DraftShot } from './model'

export const DRAFT_EXTENSION = '.cawmera'
const FALLBACK_NAME = 'whats-new-draft'
const SAVE_FAILED = 'The draft couldn’t be saved'
const OPEN_FAILED = 'The draft couldn’t be opened'
const OPEN_FAILURES: Record<DraftFailure | DraftOpenFailure, string> = {
  'not-a-draft': 'That file isn’t a Cawmera draft',
  'newer-version': 'This draft was made by a newer Cawmera',
  damaged: 'The draft is damaged',
  'too-large': OPEN_FAILED,
  unreadable: OPEN_FAILED
}
const PNG_IHDR = 0x49484452

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const draftName = (doc: Doc) => `${slugify(doc.fileName) || FALLBACK_NAME}${DRAFT_EXTENSION}`

const sourceName = ({ doc }: ShotRecord) => (doc.recording ? getRecording(doc.sourceId)?.name : getSource(doc.sourceId)?.name) ?? ''

let saving: Promise<boolean> | null = null
let opening: Promise<void> | null = null

const syncDraftBusy = () => store.set({ draftBusy: saving !== null || opening !== null })

/** One toast per save or open: updating a shared one would carry the last one's file name and button into the next. */
function draftToast(running: string) {
  let id: string | number | undefined
  return {
    progress(share: number) {
      id = toast.loading(`${running} ${Math.round(share * 100)}%`, { id })
    },
    done(title: string, data: ExternalToast = {}) {
      toast.success(title, { ...data, id })
    },
    failed(title: string, description?: string) {
      toast.error(title, { id, description })
    }
  }
}

async function withProgress<T>(target: CawmeraBridge, onProgress: (share: number) => void, work: () => Promise<T>): Promise<T> {
  const stopProgress = target.onDraftProgress(onProgress)
  try {
    return await work()
  } finally {
    stopProgress()
  }
}

// ---------------------------------------------------------------------------
// Saving

/** The screenshot as it was loaded, at its own size: not the framed shot. */
async function screenshotPng(sourceId: string): Promise<Uint8Array> {
  const source = getSource(sourceId)
  if (!source) throw new Error('A screenshot in this draft is no longer available')
  const canvas = new OffscreenCanvas(source.width, source.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is unavailable')
  ctx.drawImage(source.bitmap, 0, 0)
  return blobBytes(await canvas.convertToBlob({ type: 'image/png' }))
}

function takeTrack(takeId: string): string {
  const entry = getRecording(takeId)
  if (!entry) throw new Error('A recording in this draft is no longer available')
  return serializeTrack(entry.track)
}

async function draftFiles(shots: ShotRecord[], activeId: string, style: HouseStyle, appVersion: string): Promise<DraftFiles> {
  const { manifest, keys } = buildDraftManifest(shots, activeId, style, appVersion, sourceName)
  const recordings = [...keys.take].map(([id, key]) => ({ key, id, track: takeTrack(id) }))
  const screenshots: DraftFiles['screenshots'] = []
  for (const [sourceId, key] of keys.image) screenshots.push({ key, bytes: await screenshotPng(sourceId) })
  return { manifest, screenshots, recordings }
}

/** The shots as they are now go into the draft; edits made while it's written stay unsaved. */
async function saveCanvas(target: CawmeraBridge): Promise<boolean> {
  const shots = liveShots()
  const { activeId, style, doc } = store.get()
  const status = draftToast('Saving draft…')
  try {
    const files = await draftFiles(shots, activeId, style, await target.getVersion())
    const result = await withProgress(target, status.progress, () => target.saveDraft(files, draftName(doc)))
    if (!result) return false
    if ('error' in result) {
      status.failed(SAVE_FAILED, result.error)
      return false
    }
    markDraftSaved(shots)
    const file = savedFile(result.path)
    status.done('Draft saved', { description: file.name, action: file.showInFolder })
    return true
  } catch (error) {
    status.failed(SAVE_FAILED, messageOf(error))
    return false
  }
}

/** True when the draft was written. A call while a save runs waits for that one instead of starting another. */
export async function saveDraft(): Promise<boolean> {
  if (!bridge) return false
  if (!saving) {
    saving = saveCanvas(bridge).finally(() => {
      saving = null
      syncDraftBusy()
    })
    syncDraftBusy()
  }
  return saving
}

/** Before unsaved work would be lost, offers to save it in a draft or discard it. False when it's kept, or the draft didn't cover it. */
export async function saveOrDiscardUnsaved(purpose: DiscardPurpose): Promise<boolean> {
  const count = unsavedCount()
  if (count === 0) return true
  const answer = (await bridge?.confirmDiscard(count, purpose)) ?? 'keep'
  if (answer === 'discard') return true
  if (answer !== 'save') return false
  // A save that ended while the dialog was up may have covered everything already.
  if (unsavedCount() === 0) return true
  return (await saveDraft()) && unsavedCount() === 0
}

// ---------------------------------------------------------------------------
// Opening

function pngSize(bytes: Uint8Array): Size | null {
  if (bytes.byteLength < 24) return null
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return header.getUint32(12) === PNG_IHDR ? { width: header.getUint32(16), height: header.getUint32(20) } : null
}

/** Cawmera saves only screenshots it could load, so a larger one is refused from its header, before a small file unpacks into gigapixels. */
async function decodedScreenshot(bytes: Uint8Array): Promise<ImageBitmap> {
  const size = pngSize(bytes)
  if (!size || size.width * size.height > MAX_SOURCE_PIXELS) throw new DraftError('damaged')
  try {
    return await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
  } catch {
    throw new DraftError('damaged')
  }
}

async function decodedScreenshots(screenshots: DraftFiles['screenshots']): Promise<Map<string, ImageBitmap>> {
  const bitmaps = new Map<string, ImageBitmap>()
  try {
    for (const { key, bytes } of screenshots) bitmaps.set(key, await decodedScreenshot(bytes))
    return bitmaps
  } catch (error) {
    for (const bitmap of bitmaps.values()) bitmap.close()
    throw error
  }
}

function trackOf(json: string): RecordingTrack {
  try {
    return parseTrack(JSON.parse(json))
  } catch {
    throw new DraftError('damaged')
  }
}

/** The decoded screenshots that shots show, as sources; the rest are closed. */
function sourcesOf(shots: DraftShot[], bitmaps: Map<string, ImageBitmap>): Map<string, SourceEntry> {
  const sources = new Map<string, SourceEntry>()
  for (const [key, bitmap] of bitmaps) {
    const shot = shots.find((candidate) => candidate.kind === 'screenshot' && candidate.key === key)
    if (shot?.kind === 'screenshot') sources.set(key, { id: newId(), bitmap, width: bitmap.width, height: bitmap.height, ...shot.source })
    else bitmap.close()
  }
  return sources
}

function recordingsOf(shots: DraftShot[], files: DraftFiles['recordings'], tracks: Map<string, RecordingTrack>): Map<string, RecordingEntry> {
  const recordings = new Map<string, RecordingEntry>()
  for (const { key, id } of files) {
    const shot = shots.find((candidate) => candidate.kind === 'recording' && candidate.key === key)
    const track = tracks.get(key)
    if (shot?.kind === 'recording' && track) recordings.set(key, { id, name: shot.name, track, poster: null })
  }
  return recordings
}

interface OpenedDraft {
  contents: DraftContents
  sources: Map<string, SourceEntry>
  recordings: Map<string, RecordingEntry>
}

/** The manifest is checked against its screenshots' sizes, so they're decoded first; a failure closes them all. */
async function readOpenedDraft(files: DraftFiles): Promise<OpenedDraft> {
  const tracks = new Map(files.recordings.map(({ key, track }) => [key, trackOf(track)]))
  const bitmaps = await decodedScreenshots(files.screenshots)
  try {
    const sizes = new Map([...bitmaps].map(([key, bitmap]) => [key, { width: bitmap.width, height: bitmap.height }]))
    const contents = parseDraftManifest(files.manifest, tracks, sizes)
    return { contents, sources: sourcesOf(contents.shots, bitmaps), recordings: recordingsOf(contents.shots, files.recordings, tracks) }
  } catch (error) {
    for (const bitmap of bitmaps.values()) bitmap.close()
    throw error
  }
}

function sourceIdOf(shot: DraftShot, sources: Map<string, SourceEntry>, recordings: Map<string, RecordingEntry>): string | null {
  if (shot.kind === 'empty') return null
  const entry = shot.kind === 'screenshot' ? sources.get(shot.key) : recordings.get(shot.key)
  if (!entry) throw new Error(`The draft’s ${shot.kind} ${shot.key} wasn’t read`)
  return entry.id
}

async function loadPosters(takeIds: string[]) {
  for (const id of takeIds) await loadPoster(id)
}

/** `sources` and `recordings` hold the draft's screenshots and takes by key. Each take gets its poster, as a finished take does. */
export function applyOpenedDraft(contents: DraftContents, sources: Map<string, SourceEntry>, recordings: Map<string, RecordingEntry>): void {
  const shots = contents.shots.map(
    (shot): ShotRecord => ({ id: newId(), doc: { ...shot.doc, sourceId: sourceIdOf(shot, sources, recordings) }, past: [], future: [], savedDoc: null, draftDoc: null })
  )
  replaceCanvas(shots, contents.active, contents.style)
  for (const source of sources.values()) registerSource(source)
  for (const recording of recordings.values()) registerRecording(recording)
  void loadPosters([...recordings.values()].map(({ id }) => id))
}

function failedToOpen(error: unknown): [title: string, description?: string] {
  return error instanceof DraftError ? [OPEN_FAILURES[error.reason]] : [OPEN_FAILED, messageOf(error)]
}

async function openOntoCanvas(target: CawmeraBridge, path: string | null): Promise<void> {
  const status = draftToast('Opening draft…')
  try {
    if (!(await saveOrDiscardUnsaved('open'))) return
    const result = await withProgress(target, status.progress, () => target.openDraft(path))
    if (!result) return
    if (!result.ok) return status.failed(OPEN_FAILURES[result.reason], result.message)
    const { contents, sources, recordings } = await readOpenedDraft(result.files)
    applyOpenedDraft(contents, sources, recordings)
    status.done(houseStyleImported(contents.style))
  } catch (error) {
    status.failed(...failedToOpen(error))
  }
}

/** Asks first when work is unsaved. A null path lets main's dialog pick the draft; on failure the canvas stays as it was. */
export async function openDraft(path: string | null): Promise<void> {
  if (!bridge) return
  if (saving || opening) return void toast.error(OPEN_FAILED, { description: DRAFT_BUSY })
  opening = openOntoCanvas(bridge, path).finally(() => {
    opening = null
    syncDraftBusy()
  })
  syncDraftBusy()
  return opening
}

/** A dropped or picked draft opens from its path, which main takes only from a local drive. */
export async function openDraftFile(file: File): Promise<void> {
  if (!bridge) return
  return openDraft(bridge.pathForFile(file))
}

const isDraftFile = (file: File) => file.name.toLowerCase().endsWith(DRAFT_EXTENSION)

/** On desktop, the first draft among dropped or picked files: it opens alone, in place of the canvas. */
export const draftAmong = (files: File[]): File | undefined => (bridge ? files.find(isDraftFile) : undefined)
