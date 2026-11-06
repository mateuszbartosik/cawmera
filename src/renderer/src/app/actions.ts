import { toast } from 'sonner'
import type { CaptureSource } from '@shared/types'
import {
  DEFAULT_DOC,
  DEFAULT_SPOTLIGHT,
  exportFileName,
  FORMAT_LABEL,
  normalizeAngle,
  randomAngle,
  snapDensity,
  shotFallbackName,
  slugify,
  type Density,
  type Doc,
  type Edge,
  type ExportFormat,
  type Fill
} from './doc'
import { readBackdrop } from './backdrop'
import { toastExportFailed, toastSaved } from './save-toast'
import { evenSize } from './size'
import { DEFAULT_HOUSE_STYLE, loadHouseStyle, serializeHouseStyle } from './house-style'
import { shuffledLook } from './shuffle'
import {
  addShot,
  backdropReady,
  commitFrom,
  FIT_ALL,
  getSource,
  liveShots,
  markSaved,
  newId,
  registerSource,
  removeShots,
  restoreShots,
  selectShot,
  store,
  updateDoc,
  type BoxRef,
  type ShotRecord,
  type SourceEntry
} from './store'
import { layoutFor, renderImage, type Scene } from '../render/compose'
import type { Size } from '../render/geometry'
import { centeredBox } from '../render/layout'
import { revealActive } from '../canvas/view'
import {
  bridge,
  copyPng as copyPngToClipboard,
  displayDensity,
  grabFrame,
  readClipboardImageFallback,
  saveImage,
  saveImages,
  stopStream
} from '../platform/bridge'

const MAX_PIXELS = 60_000_000
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// Loading a screenshot. An empty active shot is filled; otherwise the image gets a new shot at the
// end of the row, so nothing already framed is ever replaced.

export async function loadBitmap(bitmap: ImageBitmap, meta: { name: string; origin: SourceEntry['origin']; density?: Density }) {
  if (bitmap.width * bitmap.height > MAX_PIXELS) {
    bitmap.close()
    toast.error('That image is too large', { description: 'Use a screenshot under 60 megapixels.' })
    return
  }
  const entry: SourceEntry = {
    id: newId(),
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    name: meta.name,
    origin: meta.origin,
    detected: meta.density ?? displayDensity()
  }
  registerSource(entry)
  const current = store.get().doc
  const fillsActive = current.sourceId === null
  const last = liveShots().at(-1)?.doc
  const doc: Doc = {
    ...DEFAULT_DOC,
    sourceId: entry.id,
    capturedAt: entry.detected,
    // Size and background carry over like the light colour: one change covers a whole set of images.
    size: fillsActive ? current.size : (last?.size ?? DEFAULT_DOC.size),
    fill: fillsActive ? current.fill : (last?.fill ?? DEFAULT_DOC.fill),
    // Keep the redaction look across shots of one entry.
    redactStyle: current.redactStyle,
    spotlight: { ...DEFAULT_SPOTLIGHT, dim: current.spotlight.dim, outline: current.spotlight.outline },
    // A new shot sits next to the last one, so its light must differ from that one; colour and
    // intensity carry over, so one change covers the whole entry.
    angle: fillsActive ? current.angle : randomAngle(last?.angle),
    lightColor: fillsActive ? current.lightColor : (last?.lightColor ?? null),
    lightIntensity: fillsActive ? current.lightIntensity : (last?.lightIntensity ?? DEFAULT_DOC.lightIntensity),
    fileName: fillsActive ? current.fileName : ''
  }
  if (fillsActive) updateDoc(doc)
  else addShot(doc)
  // A full window capture almost always needs cropping; pasted snips usually don't.
  const cropping = meta.origin === 'capture'
  store.set({ mode: cropping ? 'crop' : 'compose', selection: [], ...(cropping ? { cropView: FIT_ALL } : {}) })
  revealActive()
}

export async function loadBlob(blob: Blob, name: string, origin: SourceEntry['origin']) {
  if (!blob.type.startsWith('image/') && blob.type !== '') {
    toast.error(`${name} is not an image`)
    return
  }
  try {
    await loadBitmap(await createImageBitmap(blob), { name, origin })
  } catch {
    toast.error(`Could not read ${name}`)
  }
}

const isStyleFile = (file: File) => file.type === 'application/json' || /\.json$/i.test(file.name)

/** Several files at once (drop or browse): one shot each, in order. A dropped .json is a house style. */
export async function loadFiles(files: File[], origin: SourceEntry['origin']) {
  const style = files.find(isStyleFile)
  if (style) await importHouseStyleFile(style)
  const images = files.filter((file) => file.type.startsWith('image/'))
  if (images.length === 0) {
    if (files.length && !style) toast.error('Those files are not images')
    return
  }
  for (const file of images) await loadBlob(file, file.name, origin)
  if (images.length > 1) toast(`Added ${images.length} shots`)
}

export function openFilePicker() {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'
  input.onchange = () => void loadFiles([...(input.files ?? [])], 'file')
  input.click()
}

export async function pasteFromEvent(event: ClipboardEvent) {
  const target = event.target as HTMLElement | null
  const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  const items = [...(event.clipboardData?.items ?? [])]
  const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'))
  if (imageItem) {
    const file = imageItem.getAsFile()
    if (file) {
      event.preventDefault()
      await loadBlob(file, 'Pasted image', 'paste')
      return
    }
  }
  if (typing) return
  const fallback = await readClipboardImageFallback()
  if (fallback) await loadBlob(fallback, 'Pasted image', 'paste')
  else toast('The clipboard has no image', { description: 'Copy a screenshot first, then paste it here.' })
}

// ---------------------------------------------------------------------------
// Shots

export function newShot() {
  addShot()
  revealActive()
}

export function activateShot(id: string) {
  selectShot(id)
}

export function stepShot(direction: 1 | -1) {
  const shots = liveShots()
  const index = shots.findIndex((record) => record.id === store.get().activeId)
  const next = shots[(index + direction + shots.length) % shots.length]
  if (!next) return
  selectShot(next.id)
  revealActive()
}

export function deleteShot(id: string) {
  deleteShots([id])
}

/** Deletes shots, with one Undo for all of them. Empty shots go without a toast: there's nothing to lose. */
export function deleteShots(ids: string[]) {
  const result = removeShots(ids)
  if (!result || result.removed.every(({ record }) => record.doc.sourceId === null)) return
  const count = result.removed.length
  toast(count === 1 ? 'Shot deleted' : `${count} shots deleted`, {
    action: { label: 'Undo', onClick: () => restoreShots(result) }
  })
}

/** Delete with shots picked on the canvas. */
export function deletePickedShots() {
  deleteShots(store.get().shotSelection)
}

/** File name a shot exports under (empty names get a numbered default). */
export function shotFileName(record: ShotRecord, index: number) {
  return exportFileName(record.doc.fileName, store.get().format, shotFallbackName(index))
}

// ---------------------------------------------------------------------------
// Capture

/** Set by Cancel (on screen or in the app) while a capture waits. */
let captureCancelled = false

/** Ends a waiting countdown the way Cancel does, without touching the capture state. */
export const interruptCountdown = () => {
  captureCancelled = true
}
export const resetCancellation = () => {
  captureCancelled = false
}

export function startCapture() {
  if (store.get().capture.phase !== 'idle') return
  if (bridge) {
    store.set({ captureMode: 'screenshot', capture: { phase: 'picking', remaining: 0 } })
    return
  }
  void captureInBrowser()
}

export function cancelCapture() {
  captureCancelled = true
  store.set({ capture: { phase: 'idle', remaining: 0 } })
}

/**
 * Counts down in whole seconds, by the clock: a late timer never stretches a second. False when the
 * capture was cancelled meanwhile.
 */
export async function countdown(seconds: number, onTick?: (remaining: number) => void): Promise<boolean> {
  const end = performance.now() + seconds * 1000
  let shown = 0
  for (;;) {
    if (captureCancelled) return false
    const remaining = Math.ceil((end - performance.now()) / 1000)
    if (remaining <= 0) break
    if (remaining !== shown) {
      shown = remaining
      store.set({ capture: { phase: 'countdown', remaining } })
      onTick?.(remaining)
    }
    await wait(Math.min(100, Math.max(10, end - performance.now() - (remaining - 1) * 1000)))
  }
  store.set({ capture: { phase: 'grabbing', remaining: 0 } })
  return true
}

/** Desktop: the source was picked in our own dialog; Electron hands it to getDisplayMedia directly. */
export async function captureSource(source: CaptureSource) {
  if (!bridge) return
  const delay = store.get().delay
  captureCancelled = false
  let stream: MediaStream | null = null
  let countdownShown = false
  try {
    store.set({ capture: { phase: 'grabbing', remaining: 0 } })
    const armed = await bridge.prepareCapture(source.id)
    if (!armed) throw new Error('Source rejected')
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 7680 }, height: { ideal: 4320 }, frameRate: { ideal: 10, max: 30 } },
      audio: false
    })
    await bridge.hideWindow()
    if (delay > 0) {
      countdownShown = true
      const { doc, style } = store.get()
      await bridge.showCountdown({ displayId: source.displayId, seconds: delay, color: doc.lightColor ?? style.glow })
      const finished = await countdown(delay, (remaining) => {
        bridge?.tickCountdown(remaining)
        bridge?.setProgress((delay - remaining + 1) / (delay + 1))
      })
      // The countdown has to be off the screen before the frame is read.
      await bridge.hideCountdown()
      countdownShown = false
      if (!finished) return
    }
    if (captureCancelled) return
    const bitmap = await grabFrame(stream)
    await loadBitmap(bitmap, { name: source.name, origin: 'capture', density: snapDensity(source.scaleFactor) })
  } catch (error) {
    console.error('Capture failed', error)
    toast.error('Capture failed', { description: error instanceof Error ? error.message : String(error) })
  } finally {
    if (countdownShown) await bridge.hideCountdown()
    stopStream(stream)
    store.set({ capture: { phase: 'idle', remaining: 0 } })
    await bridge.restoreWindow()
  }
}

/** Browser build: the browser's own picker (pick a tab, window or screen), then the same delay. */
async function captureInBrowser() {
  let stream: MediaStream | null = null
  const title = document.title
  captureCancelled = false
  try {
    store.set({ capture: { phase: 'picking', remaining: 0 } })
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' },
      audio: false,
      // Chrome-only hints; other browsers ignore them.
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude'
    } as DisplayMediaStreamOptions)
    const delay = store.get().delay
    const finished = await countdown(delay, (remaining) => {
      document.title = `Capturing in ${remaining}…`
    })
    if (!finished) return
    const bitmap = await grabFrame(stream)
    await loadBitmap(bitmap, { name: 'Capture', origin: 'capture' })
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotAllowedError')) {
      toast.error('Capture failed', { description: error instanceof Error ? error.message : String(error) })
    }
  } finally {
    document.title = title
    stopStream(stream)
    store.set({ capture: { phase: 'idle', remaining: 0 } })
  }
}

// ---------------------------------------------------------------------------
// Export

function sceneFor(doc: Doc): Scene | null {
  const source = getSource(doc.sourceId)
  const { style, backdrop } = store.get()
  return source ? { source: { image: source.bitmap, width: source.width, height: source.height }, doc, style, backdrop: backdrop?.bitmap ?? null } : null
}

const sizeLabel = ({ width, height }: Size, format: ExportFormat) => `${width} × ${height} ${FORMAT_LABEL[format]}`

export async function exportImage() {
  await backdropReady()
  const { doc, format, activeId } = store.get()
  const scene = sceneFor(doc)
  if (!scene) {
    toast('Add a screenshot first', { description: 'Paste, drop, browse or capture one.' })
    return
  }
  leaveCrop()
  const index = liveShots().findIndex((record) => record.id === activeId)
  const name = exportFileName(doc.fileName, format, shotFallbackName(index))
  try {
    const saved = await saveImage(await renderImage(scene, format), name, format)
    if (!saved) return
    markSaved([activeId])
    toastSaved(saved, name, sizeLabel(doc.size, format))
  } catch (error) {
    toastExportFailed(error)
  }
}

export async function exportAll() {
  await backdropReady()
  const { format } = store.get()
  leaveCrop()
  const shots = liveShots()
    .map((record, index) => ({ record, index, scene: record.doc.recording ? null : sceneFor(record.doc) }))
    .filter((item) => item.scene)
  if (shots.length === 0) {
    toast('Add a screenshot first', { description: 'Paste, drop, browse or capture one.' })
    return
  }
  try {
    const images = await Promise.all(
      shots.map(async ({ record, index, scene }) => ({ name: shotFileName(record, index), blob: await renderImage(scene!, format) }))
    )
    const saved = await saveImages(images)
    if (!saved) return
    markSaved(shots.map(({ record }) => record.id))
    toast.success(`Exported ${saved.count} ${saved.count === 1 ? 'image' : 'images'}`, {
      description: saved.folder ? saved.folder : FORMAT_LABEL[format]
    })
  } catch (error) {
    toastExportFailed(error)
  }
}

export async function copyImage() {
  await backdropReady()
  const scene = sceneFor(store.get().doc)
  if (!scene) {
    toast('Add a screenshot first', { description: 'Paste, drop, browse or capture one.' })
    return
  }
  leaveCrop()
  try {
    await copyPngToClipboard(await renderImage(scene, 'png'))
    toast.success('Copied to clipboard', { description: `${sizeLabel(scene.doc.size, 'png')} (clipboards only take PNG)` })
  } catch (error) {
    toast.error('Copy failed', { description: error instanceof Error ? error.message : String(error) })
  }
}

// ---------------------------------------------------------------------------
// Editing

export function enterCrop() {
  const { doc } = store.get()
  if (!doc.sourceId || doc.recording) return
  store.set({ mode: 'crop', selection: [], shotSelection: [], cropView: FIT_ALL })
}

export function leaveCrop() {
  if (store.get().mode !== 'crop') return
  store.set({ mode: 'compose' })
}

function layoutNow() {
  const scene = sceneFor(store.get().doc)
  return scene ? layoutFor(scene) : null
}

export function setEdge(edge: Edge | null) {
  if (store.get().doc.edge !== edge) updateDoc({ edge })
}

/** `history: false` while dragging the light; the drag records one step when it ends. */
export function setAngle(angle: number, history = true) {
  const next = normalizeAngle(angle)
  if (store.get().doc.angle !== next) updateDoc({ angle: next }, { history })
}

/** The colour picker reports every step of a drag: quick successive changes make one undo step. */
let lastColorChange = 0
export function setLightColor(color: string | null) {
  const now = performance.now()
  const continuing = now - lastColorChange < 600
  lastColorChange = now
  if (store.get().doc.lightColor !== color) updateDoc({ lightColor: color }, { history: !continuing })
}

/** `history: false` while dragging the slider; commit the drag with commitFrom. */
export function setLightIntensity(intensity: number, history = true) {
  const next = Math.max(0, Math.min(1, Math.round(intensity * 100) / 100))
  if (store.get().doc.lightIntensity !== next) updateDoc({ lightIntensity: next }, { history })
}

export function setSize(requested: Size) {
  const { doc } = store.get()
  const size = doc.recording ? evenSize(requested) : requested
  if (doc.size.width !== size.width || doc.size.height !== size.height) updateDoc({ size })
}

export function setFill(fill: Fill) {
  if (store.get().doc.fill !== fill) updateDoc({ fill })
}

/** Background section reset: the house gradient, its colour and strength; the direction stays. */
export function resetBackground() {
  updateDoc({ fill: DEFAULT_DOC.fill, lightColor: DEFAULT_DOC.lightColor, lightIntensity: DEFAULT_DOC.lightIntensity })
}

/** A new edge and light direction for the active shot (R). */
export function shuffleLook() {
  const { doc, style } = store.get()
  updateDoc(shuffledLook(doc, getSource(doc.sourceId), style))
}

/** The picked image becomes the house background, for every shot set to Image. */
export async function setBackgroundImage(file: File) {
  if (!file.type.startsWith('image/')) {
    toast.error(`${file.name} is not an image`)
    return
  }
  try {
    const { url, bitmap } = await readBackdrop(file)
    store.set((s) => ({ style: { ...s.style, backgroundImage: url }, backdrop: { url, bitmap } }))
    setFill('image')
  } catch {
    toast.error(`Could not read ${file.name}`)
  }
}

export function pickBackgroundImage() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'
  input.onchange = () => {
    const file = input.files?.[0]
    if (file) void setBackgroundImage(file)
  }
  input.click()
}

export function removeBackgroundImage() {
  store.set((s) => ({ style: { ...s.style, backgroundImage: null } }))
}

export function addRedaction() {
  const layout = layoutNow()
  if (!layout) return
  leaveCrop()
  const id = newId()
  const offset = store.get().doc.redactions.length * 12
  const box = centeredBox(layout, 0.28, 0.07)
  updateDoc((doc) => ({ redactions: [...doc.redactions, { id, rect: { ...box, x: box.x + offset, y: box.y + offset } }] }))
  store.set({ selection: [{ kind: 'redaction', id }] })
}

/** Deletes every selected box (blur boxes and the spotlight) in one undo step. */
export function removeSelected() {
  const { selection } = store.get()
  if (selection.length === 0) return
  const blurs = new Set(selection.flatMap((box) => (box.kind === 'redaction' ? [box.id] : [])))
  const spotlight = selection.some((box) => box.kind === 'spotlight')
  updateDoc((doc) => ({
    redactions: doc.redactions.filter((r) => !blurs.has(r.id)),
    spotlight: spotlight ? { ...doc.spotlight, on: false } : doc.spotlight
  }))
  store.set({ selection: [] })
}

/** Ctrl+A with a box selected: every blur box and the spotlight of this shot. */
export function selectAllBoxes() {
  const { doc } = store.get()
  const boxes: BoxRef[] = doc.redactions.map((r) => ({ kind: 'redaction', id: r.id }))
  if (doc.spotlight.on && doc.spotlight.rect) boxes.push({ kind: 'spotlight' })
  store.set({ selection: boxes, shotSelection: [] })
}

export function addSpotlight() {
  const layout = layoutNow()
  if (!layout) return
  leaveCrop()
  updateDoc((doc) => ({ spotlight: { ...doc.spotlight, on: true, rect: doc.spotlight.rect ?? centeredBox(layout, 0.42, 0.36) } }))
  store.set({ selection: [{ kind: 'spotlight' }] })
}

export function resetScreenshotSection() {
  const { doc } = store.get()
  const source = getSource(doc.sourceId)
  updateDoc({ crop: null, edge: null, zoom: DEFAULT_DOC.zoom, capturedAt: source?.detected ?? DEFAULT_DOC.capturedAt })
}

export function resetRedactions() {
  updateDoc({ redactions: [], redactStyle: DEFAULT_DOC.redactStyle })
}

export function resetSpotlight() {
  updateDoc({ spotlight: DEFAULT_SPOTLIGHT })
}

/** Panel header reset: back to the freshly loaded shot, keeping the screenshot, size, background, light and name. */
export function resetAll() {
  const { doc } = store.get()
  const source = getSource(doc.sourceId)
  updateDoc({
    ...DEFAULT_DOC,
    sourceId: doc.sourceId,
    size: doc.size,
    fill: doc.fill,
    capturedAt: source?.detected ?? 1,
    angle: doc.angle,
    lightColor: doc.lightColor,
    lightIntensity: doc.lightIntensity,
    fileName: doc.fileName
  })
  store.set({ selection: [], mode: 'compose' })
}

export function clearSource() {
  updateDoc((doc) => ({
    ...DEFAULT_DOC,
    size: doc.size,
    fill: doc.fill,
    angle: doc.angle,
    lightColor: doc.lightColor,
    lightIntensity: doc.lightIntensity,
    fileName: doc.fileName
  }))
  store.set({ selection: [], mode: 'compose' })
}

export function setFileName(value: string, commit = false) {
  updateDoc({ fileName: commit ? slugify(value) : value }, { history: false })
}

/** Arrow keys: moves every selected box. */
export function nudgeSelected(dx: number, dy: number) {
  const { selection, doc } = store.get()
  if (selection.length === 0) return
  const before: Doc = doc
  const blurs = new Set(selection.flatMap((box) => (box.kind === 'redaction' ? [box.id] : [])))
  const spotlight = selection.some((box) => box.kind === 'spotlight')
  const shift = <T extends { x: number; y: number }>(r: T): T => ({ ...r, x: r.x + dx, y: r.y + dy })
  updateDoc(
    (d) => ({
      redactions: d.redactions.map((r) => (blurs.has(r.id) ? { ...r, rect: shift(r.rect) } : r)),
      spotlight: spotlight && d.spotlight.rect ? { ...d.spotlight, rect: shift(d.spotlight.rect) } : d.spotlight
    }),
    { history: false }
  )
  commitFrom(before)
}

// ---------------------------------------------------------------------------
// House style (designer only)

export function exportHouseStyle() {
  const blob = new Blob([JSON.stringify(serializeHouseStyle(store.get().style), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'cawmera-house-style.json'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function importHouseStyle() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json,.json'
  input.onchange = () => {
    const file = input.files?.[0]
    if (file) void importHouseStyleFile(file)
  }
  input.click()
}

/** A house style shared as a JSON file (Import style, or dropped onto the window). */
export async function importHouseStyleFile(file: File) {
  try {
    const raw: unknown = JSON.parse(await file.text())
    if (!raw || typeof raw !== 'object' || !('plateFrom' in raw || 'glow' in raw)) throw new Error('not a house style')
    const style = loadHouseStyle(raw)
    store.set({ style })
    toast.success(style.name ? `${style.name} house style imported` : 'House style imported')
  } catch {
    toast.error(`${file.name} is not a house style`)
  }
}

export function resetHouseStyle() {
  store.set({ style: DEFAULT_HOUSE_STYLE })
}
