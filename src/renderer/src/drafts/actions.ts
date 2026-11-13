import { toast, type ExternalToast } from 'sonner'
import { DRAFT_BUSY, type CawmeraBridge, type DiscardPurpose, type DraftFiles, type DraftOpenFailure } from '@shared/types'
import { slugify, type Doc } from '../app/doc'
import { houseStyleImported } from '../app/house-style'
import { savedFile } from '../app/save-toast'
import {
  getSource,
  liveShots,
  markDraftSaved,
  MAX_DRAFT_PIXELS,
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
import { serializeTrack, type RecordingTrack } from '../recording/track'
import type { Size } from '../render/geometry'
import {
  buildDraftManifest,
  DraftError,
  fitsDraftLimits,
  parseDraftManifest,
  parseDraftTrack,
  type DraftContents,
  type DraftFailure,
  type DraftShot
} from './model'

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
const TOO_MANY_PIXELS = `Its screenshots add up to more than ${MAX_DRAFT_PIXELS / 1_000_000} megapixels.`
const TOO_BIG_FOR_A_DRAFT = 'This canvas is too big for a draft'
const TOO_MANY_PIXELS_TO_SAVE = `${TOO_MANY_PIXELS} Remove some shots and try again.`
const TOO_MANY_PARTS_TO_SAVE = 'It has more shots, blur boxes, zooms or clips than a draft can hold. Remove some and try again.'
const ONLY_THE_DRAFT = 'Only the draft was opened, not the other files'
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PNG_IHDR = 0x49484452
const IHDR_LENGTH = 13

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const draftName = (doc: Doc) => `${slugify(doc.fileName) || FALLBACK_NAME}${DRAFT_EXTENSION}`

const sourceName = ({ doc }: ShotRecord) => (doc.recording ? getRecording(doc.sourceId)?.name : getSource(doc.sourceId)?.name) ?? ''

let saving: Promise<boolean> | null = null
let opening: Promise<boolean> | null = null

const syncDraftBusy = () => store.set({ draftBusy: saving !== null || opening !== null })

/** One toast per save or open: updating a shared one would carry the last one's file name and button into the next. */
function draftToast(running: string) {
  let id: string | number | undefined
  return {
    started() {
      id = toast.loading(running, { id })
    },
    progress(share: number) {
      id = toast.loading(`${running} ${Math.round(share * 100)}%`, { id })
    },
    done(title: string, data: ExternalToast = {}) {
      toast.success(title, { ...data, id })
    },
    failed(title: string, description?: string) {
      toast.error(title, { id, description })
    },
    dismiss() {
      if (id !== undefined) toast.dismiss(id)
    }
  }
}

type DraftToast = ReturnType<typeof draftToast>

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

type BuiltManifest = ReturnType<typeof buildDraftManifest>

async function draftFiles({ manifest, keys }: BuiltManifest): Promise<DraftFiles> {
  const recordings = [...keys.take].map(([id, key]) => ({ key, id, track: takeTrack(id) }))
  const screenshots: DraftFiles['screenshots'] = []
  for (const [sourceId, key] of keys.image) screenshots.push({ key, bytes: await screenshotPng(sourceId) })
  return { manifest, screenshots, recordings }
}

/** The screenshots' pixels as opening the draft would decode them: each source once, however many shots show it. */
function screenshotPixels(sourceIds: Iterable<string>): number {
  let pixels = 0
  for (const id of sourceIds) {
    const source = getSource(id)
    if (source) pixels += source.width * source.height
  }
  return pixels
}

/** Why the draft couldn't be opened again, so it's never written; checked before any PNG is encoded. Null when it could. */
function tooBigForADraft(shots: ShotRecord[], { keys }: BuiltManifest): string | null {
  if (screenshotPixels(keys.image.keys()) > MAX_DRAFT_PIXELS) return TOO_MANY_PIXELS_TO_SAVE
  return fitsDraftLimits(shots) ? null : TOO_MANY_PARTS_TO_SAVE
}

/** The shots as they are now go into the draft; edits made while it's written stay unsaved. */
async function saveCanvas(target: CawmeraBridge): Promise<boolean> {
  const shots = liveShots()
  const { activeId, style, doc } = store.get()
  const status = draftToast('Saving draft…')
  status.started()
  try {
    const built = buildDraftManifest(shots, activeId, style, await target.getVersion(), sourceName)
    const tooBig = tooBigForADraft(shots, built)
    if (tooBig) {
      status.failed(TOO_BIG_FOR_A_DRAFT, tooBig)
      return false
    }
    const files = await draftFiles(built)
    const result = await withProgress(target, status.progress, () => target.saveDraft(files, draftName(doc)))
    if (!result) {
      status.dismiss()
      return false
    }
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

/** Save draft from the File menu or Ctrl+Shift+D: like the toolbar button, it does nothing while a draft is saved or opened. */
export function saveDraftUnlessBusy() {
  if (!store.get().draftBusy) void saveDraft()
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
  if (purpose === 'close' && opening) {
    toast.error(SAVE_FAILED, { description: DRAFT_BUSY })
    return false
  }
  return (await saveDraft()) && unsavedCount() === 0
}

// ---------------------------------------------------------------------------
// Opening

/** Width and height from a PNG's header, the signature then the IHDR chunk; null for anything else, which Cawmera never saves. */
function pngSize(bytes: Uint8Array): Size | null {
  if (bytes.byteLength < 24 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return null
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (header.getUint32(8) !== IHDR_LENGTH || header.getUint32(12) !== PNG_IHDR) return null
  return { width: header.getUint32(16), height: header.getUint32(20) }
}

/** A shot whose screenshot has no size here makes the manifest damaged. */
function headerSizes(screenshots: DraftFiles['screenshots']): Map<string, Size> {
  const sizes = new Map<string, Size>()
  for (const { key, bytes } of screenshots) {
    const size = pngSize(bytes)
    if (size) sizes.set(key, size)
  }
  return sizes
}

/** Reads a take's track the first time a shot asks for it, so a track no shot shows is never read. `read` holds those read so far. */
function trackReader(recordings: DraftFiles['recordings']) {
  const jsonByKey = new Map(recordings.map(({ key, track }) => [key, track]))
  const read = new Map<string, RecordingTrack>()
  const get = (key: string): RecordingTrack | undefined => {
    const json = jsonByKey.get(key)
    if (json === undefined) return undefined
    const track = read.get(key) ?? parseDraftTrack(json)
    read.set(key, track)
    return track
  }
  return { get, read }
}

interface ShownScreenshot {
  key: string
  bytes: Uint8Array
  size: Size
  source: Extract<DraftShot, { kind: 'screenshot' }>['source']
}

/**
 * The screenshots some shot shows; the rest are never decoded. Their header sizes are checked before anything is decoded, since a
 * small file can unpack into gigapixels: each must be one Cawmera would load, and together they must stay within the draft's budget.
 */
function shownScreenshots(contents: DraftContents, screenshots: DraftFiles['screenshots'], sizes: Map<string, Size>): ShownScreenshot[] {
  const shown: ShownScreenshot[] = []
  let pixels = 0
  for (const { key, bytes } of screenshots) {
    const shot = contents.shots.find((candidate) => candidate.kind === 'screenshot' && candidate.key === key)
    const size = sizes.get(key)
    if (shot?.kind !== 'screenshot' || !size) continue
    if (size.width * size.height > MAX_SOURCE_PIXELS) throw new DraftError('damaged')
    pixels += size.width * size.height
    shown.push({ key, bytes, size, source: shot.source })
  }
  if (pixels > MAX_DRAFT_PIXELS) throw new DraftError('too-large')
  return shown
}

/** The manifest was checked against the header's size, so the bitmap must have exactly that size. */
async function decodedScreenshot({ bytes, size }: ShownScreenshot): Promise<ImageBitmap> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
  } catch {
    throw new DraftError('damaged')
  }
  if (bitmap.width === size.width && bitmap.height === size.height) return bitmap
  bitmap.close()
  throw new DraftError('damaged')
}

function releaseSources(sources: Map<string, SourceEntry>) {
  for (const { bitmap } of sources.values()) bitmap.close()
}

async function decodedSources(shown: ShownScreenshot[]): Promise<Map<string, SourceEntry>> {
  const sources = new Map<string, SourceEntry>()
  try {
    for (const screenshot of shown) {
      const bitmap = await decodedScreenshot(screenshot)
      sources.set(screenshot.key, { id: newId(), bitmap, width: bitmap.width, height: bitmap.height, ...screenshot.source })
    }
    return sources
  } catch (error) {
    releaseSources(sources)
    throw error
  }
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

async function decodedDraft(files: DraftFiles): Promise<OpenedDraft> {
  const tracks = trackReader(files.recordings)
  const sizes = headerSizes(files.screenshots)
  const contents = parseDraftManifest(files.manifest, tracks, sizes)
  const sources = await decodedSources(shownScreenshots(contents, files.screenshots, sizes))
  return { contents, sources, recordings: recordingsOf(contents.shots, files.recordings, tracks.read) }
}

/** Main's dialog or the given path, then the read and the decode. Null when the dialog was cancelled, or when main refused, with a toast saying why. */
async function readDraft(target: CawmeraBridge, path: string | null, status: DraftToast): Promise<OpenedDraft | null> {
  const result = await withProgress(target, status.progress, () => target.openDraft(path))
  if (!result) return null
  if (!result.ok) {
    status.failed(OPEN_FAILURES[result.reason], result.message)
    return null
  }
  return decodedDraft(result.files)
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

/** Unsaved work is asked about only now, just before the canvas is replaced, so nothing done while the draft was read goes unasked. */
async function replaceCanvasIfAllowed({ contents, sources, recordings }: OpenedDraft): Promise<boolean> {
  let applied = false
  try {
    if (await saveOrDiscardUnsaved('open')) {
      applyOpenedDraft(contents, sources, recordings)
      applied = true
    }
    return applied
  } finally {
    if (!applied) releaseSources(sources)
  }
}

function failedToOpen(error: unknown): [title: string, description?: string] {
  if (!(error instanceof DraftError)) return [OPEN_FAILED, messageOf(error)]
  return error.reason === 'too-large' ? [OPEN_FAILED, TOO_MANY_PIXELS] : [OPEN_FAILURES[error.reason]]
}

async function openOntoCanvas(target: CawmeraBridge, path: string | null): Promise<boolean> {
  const status = draftToast('Opening draft…')
  try {
    const draft = await readDraft(target, path, status)
    if (!draft) return false
    if (!(await replaceCanvasIfAllowed(draft))) {
      status.dismiss()
      return false
    }
    status.done(houseStyleImported(draft.contents.style))
    return true
  } catch (error) {
    status.failed(...failedToOpen(error))
    return false
  }
}

/** True once the draft replaced the canvas. A null path lets main's dialog pick the draft; on failure the canvas stays as it was. */
export async function openDraft(path: string | null): Promise<boolean> {
  if (!bridge) return false
  if (saving || opening) {
    toast.error(OPEN_FAILED, { description: DRAFT_BUSY })
    return false
  }
  opening = openOntoCanvas(bridge, path).finally(() => {
    opening = null
    syncDraftBusy()
  })
  syncDraftBusy()
  return opening
}

/** A dropped or picked draft opens from its path, which main takes only from a local drive. */
export async function openDraftFile(file: File): Promise<boolean> {
  if (!bridge) return false
  return openDraft(bridge.pathForFile(file))
}

const isDraftFile = (file: File) => file.name.toLowerCase().endsWith(DRAFT_EXTENSION)

/** On desktop, the first draft among dropped or picked files. */
export const draftAmong = (files: File[]): File | undefined => (bridge ? files.find(isDraftFile) : undefined)

/** A draft among dropped or picked files opens alone, and a toast says when other files came with it. Null when there's no draft among them. */
export function openDraftAmong(files: File[]): Promise<boolean> | null {
  const draft = draftAmong(files)
  if (!draft) return null
  return openDraftFile(draft).then((opened) => {
    if (opened && files.length > 1) toast.info(ONLY_THE_DRAFT)
    return opened
  })
}
