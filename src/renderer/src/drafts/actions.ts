import { toast } from 'sonner'
import type { CawmeraBridge, DiscardPurpose, DraftFiles } from '@shared/types'
import { slugify, type Doc } from '../app/doc'
import type { HouseStyle } from '../app/house-style'
import { getSource, liveShots, markDraftSaved, store, unsavedCount, type ShotRecord } from '../app/store'
import { blobBytes, bridge } from '../platform/bridge'
import { getRecording } from '../recording/registry'
import { serializeTrack } from '../recording/track'
import { buildDraftManifest } from './model'

const FALLBACK_NAME = 'whats-new-draft'

const draftName = (doc: Doc) => `${slugify(doc.fileName) || FALLBACK_NAME}.cawmera`

const sourceName = ({ doc }: ShotRecord) => (doc.recording ? getRecording(doc.sourceId)?.name : getSource(doc.sourceId)?.name) ?? ''

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

/** One toast per save: updating a shared one would carry the last save's file name and button into the next. */
function savingToast() {
  let id: string | number | undefined
  return {
    progress(share: number) {
      id = toast.loading(`Saving draft… ${Math.round(share * 100)}%`, { id })
    },
    saved(path: string) {
      toast.success('Draft saved', {
        id,
        description: path.split(/[\\/]/).pop(),
        action: { label: 'Show in folder', onClick: () => void bridge?.revealFile(path) }
      })
    },
    failed(problem: unknown): false {
      toast.error('The draft couldn’t be saved', { id, description: problem instanceof Error ? problem.message : String(problem) })
      return false
    }
  }
}

async function writeWithProgress(target: CawmeraBridge, files: DraftFiles, suggestedName: string, onProgress: (share: number) => void) {
  const stopProgress = target.onDraftProgress(onProgress)
  try {
    return await target.saveDraft(files, suggestedName)
  } finally {
    stopProgress()
  }
}

/** The shots as they are now go into the draft; edits made while it's written stay unsaved. */
async function saveCanvas(target: CawmeraBridge): Promise<boolean> {
  const shots = liveShots()
  const { activeId, style, doc } = store.get()
  const status = savingToast()
  try {
    const files = await draftFiles(shots, activeId, style, await target.getVersion())
    const result = await writeWithProgress(target, files, draftName(doc), status.progress)
    if (!result) return false
    if ('error' in result) return status.failed(result.error)
    markDraftSaved(shots)
    status.saved(result.path)
    return true
  } catch (error) {
    return status.failed(error)
  }
}

let saving: Promise<boolean> | null = null

/** True when the draft was written. A call while a save runs waits for that one instead of starting another. */
export async function saveDraft(): Promise<boolean> {
  if (!bridge) return false
  if (!saving) {
    store.set({ draftBusy: true })
    saving = saveCanvas(bridge).finally(() => {
      saving = null
      store.set({ draftBusy: false })
    })
  }
  return saving
}

/** Before unsaved work would be lost, offers to save it in a draft or discard it. False when it's kept, or the draft didn't cover it. */
export async function saveOrDiscardUnsaved(purpose: DiscardPurpose): Promise<boolean> {
  const count = unsavedCount()
  if (count === 0) return true
  const answer = (await bridge?.confirmDiscard(count, purpose)) ?? 'keep'
  if (answer === 'discard') return true
  return answer === 'save' && (await saveDraft()) && unsavedCount() === 0
}
