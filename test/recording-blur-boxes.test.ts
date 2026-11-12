import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Redaction } from '../src/renderer/src/app/doc'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { boxesShownAt, MIN_BOX_MS, movedBoxTime, newBoxTime, isShownAt, REDACTION_PAD_MS, stretchedBoxTime, wideViewPoint } from '../src/renderer/src/recording/blur-boxes'
import { drawRecordingFrame, type RecordingScene } from '../src/renderer/src/recording/frame'
import { recordingEditLayout } from '../src/renderer/src/recording/edit-layout'
import { DEFAULT_RECORDING } from '../src/renderer/src/recording/settings'
import { takeViewFor } from '../src/renderer/src/recording/take-view'
import { outputFrameTimes, outputToSource, timeMapOf } from '../src/renderer/src/recording/timemap'
import type { RecordingTrack } from '../src/renderer/src/recording/track'
import * as compose from '../src/renderer/src/render/compose'
import { fakeContext } from './fake-canvas'
import { output, piece, video, zoomScene } from './recording-scenes'
import { cameraMatrixAt } from '../src/renderer/src/recording/shutter'
import { sourceToOutput } from '../src/renderer/src/render/layout'
import { transformPoint } from '../src/renderer/src/render/geometry'

vi.mock('../src/renderer/src/render/compose', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/renderer/src/render/compose')>()
  return { ...original, drawRedaction: vi.fn(original.drawRedaction) }
})

const FPS = 60
const FRAME_MS = 1000 / FPS

const box = (start: number, end: number): Redaction => ({ id: 'b', rect: { x: 100, y: 100, w: 300, h: 80 }, time: { start, end } })

const take: RecordingTrack = { kind: 'window', width: 2560, height: 1440, fps: FPS, durationMs: 10_000, scale: 1, cursor: [], clicks: [] }
const wholeTrim = { start: 0, end: 10_000 }

function sceneWith(redactions: Redaction[], pieces = [piece(0, 10_000)]): RecordingScene {
  const settings = { ...DEFAULT_RECORDING, trim: wholeTrim, pieces, zooms: null }
  return {
    video,
    videoSize: { width: take.width, height: take.height },
    view: takeViewFor({ id: 'frame', name: 'Recording', poster: null, track: take }, settings, null),
    doc: { ...DEFAULT_DOC, size: output, redactions },
    settings,
    style: DEFAULT_HOUSE_STYLE,
    backdrop: null,
    wide: false
  }
}

const redactionDraws = () => vi.mocked(compose.drawRedaction).mock.calls.length
function draws(scene: RecordingScene, outputMs: number, pictureMs?: number) {
  vi.mocked(compose.drawRedaction).mockClear()
  drawRecordingFrame(fakeContext().ctx, scene, outputMs, 'export', 1, pictureMs)
  return redactionDraws()
}

beforeEach(() => {
  vi.mocked(compose.drawRedaction).mockClear()
})

describe('isShownAt', () => {
  it('shows a box over its range, padded by 8 ms', () => {
    expect(REDACTION_PAD_MS).toBe(8)
    expect([991, 992, 2008, 2009].map((t) => isShownAt(box(1000, 2000), t))).toEqual([false, true, true, false])
    expect(isShownAt({ ...box(0, 0), time: null }, 123)).toBe(true)
  })
})

describe('newBoxTime', () => {
  it('starts at the playhead and runs to the end of the trim', () => {
    expect(newBoxTime(4000, { start: 0, end: 9000 }, FPS, 10_000)).toEqual({ start: 4000, end: 9000 })
    expect(newBoxTime(8950, { start: 0, end: 9000 }, FPS, 10_000)).toEqual({ start: 8800, end: 9000 })
    expect(MIN_BOX_MS).toBe(200)
  })

  it('snaps the start down and the end up to the source frame grid', () => {
    const { start, end } = newBoxTime(4005, { start: 0, end: 9005 }, FPS, 10_000)
    expect(start).toBeCloseTo(4000, 6)
    expect(end).toBeCloseTo(9016.6667, 3)
    expect(start).toBeLessThanOrEqual(4005)
    expect(end).toBeGreaterThanOrEqual(9005)
    expect(Math.abs((end - start) / FRAME_MS - Math.round((end - start) / FRAME_MS))).toBeLessThan(1e-6)
  })
})

describe('newBoxTime inside the trim and the take', () => {
  it('starts on the frame that holds the trim start when the playhead is before it', () => {
    const { start, end } = newBoxTime(500, { start: 2000, end: 9000 }, FPS, 10_000)
    expect(start).toBeLessThanOrEqual(2000)
    expect(start).toBeGreaterThan(2000 - FRAME_MS)
    expect(end).toBe(9000)
  })

  it('starts on the frame that holds a trim start off the grid', () => {
    for (const fps of [30, 60]) {
      const frameMs = 1000 / fps
      const { start } = newBoxTime(1001, { start: 1001, end: 9000 }, fps, 10_000)
      expect(start).toBeLessThanOrEqual(1001)
      expect(start).toBeGreaterThan(1001 - frameMs)
    }
  })

  it('covers the first output frame when the playhead sits at the trim start', () => {
    for (const fps of [30, 60]) {
      const trim = { start: 1001, end: 9000 }
      const pieces = [piece(0, 10_000)]
      const map = timeMapOf(trim, pieces)
      const time = newBoxTime(1001, trim, fps, 10_000)
      expect(isShownAt({ ...box(0, 0), time }, outputToSource(map, 0))).toBe(true)
    }
  })

  it('stays on the frame grid when the trim is shorter than the minimum', () => {
    const { start, end } = newBoxTime(2000, { start: 2000, end: 2100 }, FPS, 10_000)
    expect(start).toBeLessThanOrEqual(2000)
    expect(end).toBeGreaterThanOrEqual(2100)
    expect(start).toBeLessThan(end)
  })

  it('keeps the minimum where the trim allows it', () => {
    const { start, end } = newBoxTime(5000, { start: 2000, end: 5100 }, FPS, 10_000)
    expect(end - start).toBeGreaterThanOrEqual(MIN_BOX_MS)
    expect(start).toBeGreaterThan(2000 - FRAME_MS)
  })

  it('does not run past the take when the end snaps up', () => {
    expect(newBoxTime(4000, { start: 0, end: 9999 }, FPS, 9999).end).toBe(9999)
    expect(newBoxTime(4000, { start: 0, end: 10_000 }, FPS, 10_000).end).toBe(10_000)
  })
})

describe('moved and stretched boxes', () => {
  const trim = { start: 1000, end: 9000 }
  const onGrid = (ms: number) => Math.abs(ms / FRAME_MS - Math.round(ms / FRAME_MS)) < 1e-6

  it('moves a box keeping its length, its start snapped down to a frame', () => {
    const moved = movedBoxTime({ start: 3000, end: 4000 }, 5005, trim, FPS, 10_000)
    expect(onGrid(moved.start)).toBe(true)
    expect(moved.start).toBeLessThanOrEqual(5005)
    expect(moved.end - moved.start).toBeCloseTo(1000, 6)
  })

  it('keeps a moved box inside the trim', () => {
    expect(movedBoxTime({ start: 3000, end: 4000 }, 100, trim, FPS, 10_000)).toEqual({ start: 1000, end: 2000 })
    expect(movedBoxTime({ start: 3000, end: 4000 }, 9500, trim, FPS, 10_000).end).toBeLessThanOrEqual(9000 + FRAME_MS)
  })

  it('snaps a dragged start down and a dragged end up', () => {
    const start = stretchedBoxTime({ start: 3000, end: 4000 }, 'start', 2005, trim, FPS, 10_000)
    expect(start.end).toBe(4000)
    expect(onGrid(start.start) && start.start <= 2005 && start.start > 2005 - FRAME_MS).toBe(true)
    const end = stretchedBoxTime({ start: 3000, end: 4000 }, 'end', 5005, trim, FPS, 10_000)
    expect(onGrid(end.end) && end.end >= 5005 && end.end < 5005 + FRAME_MS).toBe(true)
  })

  it('covers the first output frame of a trim off the grid after a move to the trim start', () => {
    for (const fps of [30, 60]) {
      const offGrid = { start: 1001, end: 9000 }
      const map = timeMapOf(offGrid, [piece(0, 10_000)])
      const moved = movedBoxTime({ start: 3000, end: 4000 }, 0, offGrid, fps, 10_000)
      expect(isShownAt({ ...box(0, 0), time: moved }, outputToSource(map, 0))).toBe(true)
      const frame = 1000 / fps
      expect(Math.abs(moved.start / frame - Math.round(moved.start / frame))).toBeLessThan(1e-6)
      const stretched = stretchedBoxTime({ start: 3000, end: 4000 }, 'start', 0, offGrid, fps, 10_000)
      expect(isShownAt({ ...box(0, 0), time: stretched }, outputToSource(map, 0))).toBe(true)
    }
  })

  it('moves a box capped at an off-grid take duration with its end on the grid and its last frame covered', () => {
    const fps = 30
    const frame = 1000 / fps
    const wholeTake = { start: 0, end: 9999 }
    const capped = newBoxTime(4000, wholeTake, fps, 9999)
    expect(capped.end).toBe(9999)
    const moved = movedBoxTime(capped, 3000, wholeTake, fps, 9999)
    const length = capped.end - capped.start
    expect(moved.start).toBeCloseTo(3000, 6)
    expect(Math.abs(moved.end / frame - Math.round(moved.end / frame))).toBeLessThan(1e-6)
    expect(moved.end - moved.start).toBeGreaterThanOrEqual(length - 1e-6)
    expect(moved.end - moved.start).toBeLessThan(length + frame)
    const lastHeldFrame = moved.start + length - 1
    expect([lastHeldFrame, moved.end - 1, moved.end + REDACTION_PAD_MS - 1].every((ms) => isShownAt({ ...box(0, 0), time: moved }, ms))).toBe(true)
  })

  it('keeps a box at least one frame long when the trim is empty on a frame boundary', () => {
    const { start, end } = newBoxTime(1000, { start: 1000, end: 1000 }, FPS, 10_000)
    expect(end - start).toBeGreaterThanOrEqual(FRAME_MS - 1e-6)
    const moved = movedBoxTime({ start, end }, 1000, { start: 1000, end: 1000 }, FPS, 10_000)
    expect(moved.end).toBeGreaterThan(moved.start)
  })

  it('keeps both ends on the grid at a minimum-length edge', () => {
    for (const fps of [30, 60]) {
      const frame = 1000 / fps
      const grid = (ms: number) => Math.abs(ms / frame - Math.round(ms / frame)) < 1e-6
      const shortEnd = stretchedBoxTime({ start: 3000, end: 4000 }, 'end', 3010, trim, fps, 10_000)
      const shortStart = stretchedBoxTime({ start: 3000, end: 4000 }, 'start', 3990, trim, fps, 10_000)
      for (const { start, end } of [shortEnd, shortStart]) {
        expect(grid(start) && grid(end)).toBe(true)
        expect(end - start).toBeGreaterThanOrEqual(MIN_BOX_MS - 1e-6)
      }
    }
  })

  it('keeps a stretched box at least the minimum long', () => {
    const { start, end } = stretchedBoxTime({ start: 3000, end: 4000 }, 'end', 3010, trim, FPS, 10_000)
    expect(end - start).toBeGreaterThanOrEqual(MIN_BOX_MS)
  })
})

describe('boxes in the picture', () => {
  it('reads the video itself for a drawn box, whatever scratch canvases earlier tests cached', () => {
    const readsOf = (scene: RecordingScene) => {
      const fake = fakeContext()
      drawRecordingFrame(fake.ctx, scene, 4000, 'export', 1)
      return fake.calls.filter((call) => call === 'drawImage:video').length
    }
    readsOf(sceneWith([box(0, 10_000)]))
    expect(readsOf(sceneWith([box(0, 10_000)]))).toBe(readsOf(sceneWith([])) + 1)
  })

  it('draws a box only while it is shown', () => {
    const scene = sceneWith([box(3000, 5000)])
    expect(draws(scene, 2000)).toBe(0)
    expect(draws(scene, 4000)).toBe(1)
  })

  it('draws screenshots’ untimed boxes at any time', () => {
    expect(draws(sceneWith([{ ...box(0, 0), time: null }]), 100)).toBe(1)
  })

  it('places a box through the edit layout, in video px', () => {
    const scene = sceneWith([box(0, 10_000)])
    draws(scene, 4000)
    const [, source, layout, rect, mode] = vi.mocked(compose.drawRedaction).mock.calls[0]
    expect(source).toMatchObject({ image: video, width: 2560, height: 1440 })
    expect(layout).toEqual(recordingEditLayout(scene.view, scene.videoSize, output, scene.style))
    expect(rect).toEqual(box(0, 10_000).rect)
    expect(mode).toBe(scene.doc.redactStyle)
  })

  it('covers every kept frame on both sides of a cut it straddles', () => {
    const pieces = [piece(0, 4000), piece(4000, 6000, true), piece(6000, 10_000)]
    const scene = sceneWith([box(3000, 7000)], pieces)
    const map = timeMapOf(wholeTrim, pieces)
    const frames = outputFrameTimes(map, FPS).map((o) => ({ o, source: outputToSource(map, o) }))
    const inside = frames.filter(({ source }) => source >= 3000 && source <= 7000)
    expect(inside.some(({ source }) => source < 4000) && inside.some(({ source }) => source > 6000)).toBe(true)
    expect(inside.every(({ o }) => draws(scene, o) === 1)).toBe(true)
    expect(frames.filter(({ source }) => source < 2990 || source > 7010).every(({ o }) => draws(scene, o) === 0)).toBe(true)
  })

  it('judges the box at the picture’s own source time when that differs from the output time', () => {
    const scene = sceneWith([box(3000, 5000)])
    expect(draws(scene, 0, 4000)).toBe(1)
    expect(draws(scene, 4000, 0)).toBe(0)
  })
})

describe('boxesShownAt', () => {
  const boxes = ['a', 'b', 'c'].map((id, i) => ({ ...box(i * 3000, i * 3000 + 2000), id }))

  it('lists the boxes shown at the playhead, plus the selected one', () => {
    expect(boxesShownAt(boxes, 4000, new Set(['c'])).map((b) => b.id)).toEqual(['b', 'c'])
  })

  it('lists a box with no time, and keeps the list in order', () => {
    const untimed = { ...box(0, 0), id: 'u', time: null }
    expect(boxesShownAt([...boxes, untimed], 100, new Set(['b'])).map((b) => b.id)).toEqual(['a', 'b', 'u'])
  })
})

describe('wideViewPoint', () => {
  const sourceMs = 4000
  const { view, doc, style } = zoomScene
  const layout = recordingEditLayout(view, zoomScene.videoSize, output, style)
  const wideOut = sourceToOutput(layout, { x: 1500, y: 900 })

  it('leaves a point alone while the canvas is wide', () => {
    expect(wideViewPoint(wideOut, true, view, doc.size, style, sourceMs)).toEqual(wideOut)
  })

  it('takes a point on the zoomed camera back to where it sits in the wide frame', () => {
    const shown = transformPoint(cameraMatrixAt(zoomScene, view.map.spans[0].outputStart + sourceMs), wideOut)
    expect(shown.x).not.toBeCloseTo(wideOut.x, 0)
    const back = wideViewPoint(shown, false, view, doc.size, style, sourceMs)
    expect(back.x).toBeCloseTo(wideOut.x, 6)
    expect(back.y).toBeCloseTo(wideOut.y, 6)
  })
})
