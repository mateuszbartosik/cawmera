import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordingEntry } from '../src/renderer/src/recording/registry'
import type { Piece } from '../src/renderer/src/recording/timemap'
import type { Click, CursorSample, RecordingTrack } from '../src/renderer/src/recording/track'
import type { ZoomEdit } from '../src/renderer/src/recording/zoom-edits'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

const { DEFAULT_DOC } = await import('../src/renderer/src/app/doc')
const { enterCrop, leaveCrop, resetAll } = await import('../src/renderer/src/app/actions')
const { beginGesture, emptyDoc, endGesture, selectShot, addShot, store, undo, updateDoc } = await import('../src/renderer/src/app/store')
const { currentCropFrame, drawnRecordingCrop, keepsDrawnCrop, RECORDING_CROP_MIN_PX, setCropFrame, settleRecordingCrop } = await import(
  '../src/renderer/src/recording/crop'
)
const { attachPlayer } = await import('../src/renderer/src/recording/playback')
const { aimedArea } = await import('../src/renderer/src/recording/zoom-area')
const { registerRecording } = await import('../src/renderer/src/recording/registry')
const { DEFAULT_RECORDING } = await import('../src/renderer/src/recording/settings')
const { takeViewFor } = await import('../src/renderer/src/recording/take-view')
const { wholeTake } = await import('../src/renderer/src/recording/timemap')

const video = { width: 2560, height: 1440 }

describe('recording crop rules', () => {
  it('keeps a crop inside the video, at least 64 px, in whole pixels', () => {
    expect(settleRecordingCrop({ x: -10, y: 20.4, w: 900.6, h: 500 }, video)).toEqual({ x: 0, y: 20, w: 891, h: 500 })
    expect(settleRecordingCrop({ x: 100, y: 100, w: 10, h: 10 }, video)).toEqual({ x: 100, y: 100, w: 64, h: 64 })
  })

  it('grows a small crop at the video’s edge back inside it', () => {
    expect(settleRecordingCrop({ x: 2550, y: 1430, w: 10, h: 10 }, video)).toEqual({ x: 2496, y: 1376, w: 64, h: 64 })
  })

  it('drops a crop that is the whole video', () => {
    expect(settleRecordingCrop({ x: 0, y: 0, w: 2560, h: 1440 }, video)).toBeNull()
    expect(settleRecordingCrop({ x: -50, y: -50, w: 4000, h: 3000 }, video)).toBeNull()
  })

  it('draws a crop from either corner, clipped to the video', () => {
    expect(drawnRecordingCrop({ x: 900, y: 600 }, { x: 100, y: 100 }, video)).toEqual({ x: 100, y: 100, w: 800, h: 500 })
    expect(drawnRecordingCrop({ x: 2000, y: 1000 }, { x: 3000, y: 2000 }, video)).toEqual({ x: 2000, y: 1000, w: 560, h: 440 })
  })

  it('keeps a drawn crop only when both sides reach the minimum', () => {
    expect(keepsDrawnCrop({ x: 0, y: 0, w: RECORDING_CROP_MIN_PX, h: RECORDING_CROP_MIN_PX })).toBe(true)
    expect(keepsDrawnCrop({ x: 0, y: 0, w: 63, h: 500 })).toBe(false)
    expect(keepsDrawnCrop({ x: 0, y: 0, w: 500, h: 12 })).toBe(false)
  })
})

const bitmap = () => ({ close: vi.fn() }) as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> }
const track: RecordingTrack = { kind: 'monitor', ...video, fps: 60, durationMs: 10_000, scale: 1, cursor: [], clicks: [] }
const entry: RecordingEntry = { id: 'crop-take', name: 'Take', track, poster: null }
const piece = (start: number, end: number, cut = false): Piece => ({ start, end, rate: 1, cut })
const flush = () => new Promise<void>((resolve) => setTimeout(resolve))

function fakePlayer(frame: ImageBitmap | null) {
  const player = { pause: vi.fn(), grabFrame: vi.fn(async () => frame) }
  attachPlayer(player as never)
  return player
}

function openTake() {
  registerRecording(entry)
  updateDoc(
    { ...emptyDoc(), sourceId: entry.id, recording: { ...DEFAULT_RECORDING, trim: { start: 0, end: 10_000 }, pieces: wholeTake(10_000), zooms: null } },
    { history: false }
  )
  store.set({ past: [], future: [], selection: [], timelineSelection: null, mode: 'compose', playback: { playing: false, time: 0 } })
}

beforeEach(() => {
  endGesture(beginGesture())
  setCropFrame(null)
  attachPlayer(null)
  openTake()
})

describe('crop mode on a recording', () => {
  it('pauses playback and shows the frame at the playhead', async () => {
    const frame = bitmap()
    const player = fakePlayer(frame)
    store.set({ playback: { playing: true, time: 0 } })
    enterCrop()
    expect(store.get().mode).toBe('crop')
    expect(player.pause).toHaveBeenCalled()
    expect(store.get().playback.playing).toBe(false)
    await flush()
    expect(currentCropFrame()).toBe(frame)
  })

  it('closes the frame on leaving crop mode', async () => {
    const frame = bitmap()
    fakePlayer(frame)
    enterCrop()
    await flush()
    leaveCrop()
    expect(frame.close).toHaveBeenCalledTimes(1)
    expect(currentCropFrame()).toBeNull()
  })

  it('closes the frame when the shot switches', async () => {
    const frame = bitmap()
    fakePlayer(frame)
    const recordingShot = store.get().activeId
    addShot()
    selectShot(recordingShot)
    enterCrop()
    await flush()
    selectShot(store.get().shots.find((record) => record.id !== recordingShot)!.id)
    expect(store.get().mode).toBe('compose')
    expect(frame.close).toHaveBeenCalledTimes(1)
    expect(currentCropFrame()).toBeNull()
  })

  it('closes the frame it replaces', () => {
    const first = bitmap()
    const second = bitmap()
    store.set({ mode: 'crop' })
    setCropFrame(first)
    setCropFrame(second)
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(second.close).not.toHaveBeenCalled()
    setCropFrame(second)
    expect(second.close).not.toHaveBeenCalled()
  })

  it('closes a frame that arrives after crop mode was left', async () => {
    const late = bitmap()
    fakePlayer(late)
    enterCrop()
    leaveCrop()
    await flush()
    expect(late.close).toHaveBeenCalledTimes(1)
    expect(currentCropFrame()).toBeNull()
  })

  it('still opens crop mode on a screenshot, and not on an empty shot', () => {
    updateDoc({ ...emptyDoc() }, { history: false })
    enterCrop()
    expect(store.get().mode).toBe('compose')
    updateDoc({ ...emptyDoc(), sourceId: 'screenshot' }, { history: false })
    enterCrop()
    expect(store.get().mode).toBe('crop')
    expect(currentCropFrame()).toBeNull()
  })
})

describe('Reset this shot on a recording', () => {
  const zoom: ZoomEdit = { id: 'z', start: 1000, end: 3000, depth: 2, aim: 'manual', focus: { x: 800, y: 500 } }

  it('resets only the edits and keeps the take, the trim and the Cursor and Motion settings', () => {
    updateDoc((doc) => ({
      crop: { x: 100, y: 100, w: 800, h: 600 },
      redactions: [{ id: 'b', rect: { x: 0, y: 0, w: 50, h: 50 }, time: null }],
      recording: {
        ...doc.recording!,
        trim: { start: 500, end: 9000 },
        pieces: [piece(0, 4000), piece(4000, 6000, true), piece(6000, 10_000)],
        zooms: [zoom],
        cursorSize: 2.5,
        cameraBlur: 0.1
      }
    }))
    const before = store.get().doc
    resetAll()
    const doc = store.get().doc
    expect(doc.sourceId).toBe(entry.id)
    expect(doc.crop).toBeNull()
    expect(doc.redactions).toEqual([])
    expect(doc.recording).toEqual({ ...before.recording, pieces: wholeTake(10_000), zooms: null })
    expect(doc.size).toEqual(before.size)
  })

  it('is one undo step', () => {
    updateDoc({ crop: { x: 100, y: 100, w: 800, h: 600 } })
    const before = store.get().doc
    resetAll()
    undo()
    expect(store.get().doc).toBe(before)
  })

  it('resets a screenshot as before', () => {
    updateDoc({ ...emptyDoc(), sourceId: 'screenshot', crop: { x: 1, y: 2, w: 300, h: 200 }, edge: 'r', recording: null }, { history: false })
    resetAll()
    const doc = store.get().doc
    expect(doc).toMatchObject({ sourceId: 'screenshot', crop: null, edge: null, recording: null, redactStyle: DEFAULT_DOC.redactStyle })
  })
})

describe('a crop on a recording', () => {
  const frameCrop = { x: 1000, y: 600, w: 1280, h: 720 }
  const cursor: CursorSample[] = [
    { t: 0, x: 1500, y: 900, shape: 'arrow' },
    { t: 5000, x: 1500, y: 900, shape: 'arrow' }
  ]
  const click: Click = { t: 1000, x: 1500, y: 900, button: 'left', up: 1090 }
  const clicked: RecordingEntry = { ...entry, id: 'crop-clicked', track: { ...track, cursor, clicks: [click] } }
  const settings = { ...DEFAULT_RECORDING, trim: { start: 0, end: 5000 }, pieces: wholeTake(5000), zooms: null }

  it('moves the cursor and the clicks into the frame', () => {
    const view = takeViewFor(clicked, settings, frameCrop)
    expect(view.track.clicks[0]).toMatchObject({ x: 500, y: 300 })
    expect(view.track.cursor[0]).toMatchObject({ x: 500, y: 300 })
    expect(view.frame).toEqual({ width: 1280, height: 720 })
  })

  it('keeps a stored zoom in video px and pulls its focus into the cropped frame', () => {
    const edit: ZoomEdit = { id: 'z', start: 1000, end: 3000, depth: 2, aim: 'manual', focus: { x: 2200, y: 1300 } }
    const stored = { ...settings, zooms: [edit] }
    const whole = takeViewFor(clicked, stored, null)
    const cropped = takeViewFor(clicked, stored, frameCrop)
    expect(whole.zooms[0].focus).toEqual({ x: 1920, y: 1080 })
    expect(cropped.edits).toEqual([edit])
    expect(cropped.zooms[0].focus).toEqual({ x: 960, y: 540 })
  })

  it('draws the zoom area of a stored zoom relative to the crop', () => {
    const edit: ZoomEdit = { id: 'z', start: 1000, end: 3000, depth: 2, aim: 'manual', focus: { x: 1640, y: 960 } }
    const view = takeViewFor(clicked, { ...settings, zooms: [edit] }, frameCrop)
    expect(aimedArea(edit, [], view, 1500).area).toEqual({ x: 320, y: 180, w: 640, h: 360 })
  })
})
