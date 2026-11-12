import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Redaction } from '../src/renderer/src/app/doc'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { MIN_BOX_MS, movedBoxTime, newBoxTime, isShownAt, REDACTION_PAD_MS, stretchedBoxTime } from '../src/renderer/src/recording/blur-boxes'
import { drawRecordingFrame, type RecordingScene } from '../src/renderer/src/recording/frame'
import { recordingEditLayout } from '../src/renderer/src/recording/edit-layout'
import { DEFAULT_RECORDING } from '../src/renderer/src/recording/settings'
import { takeViewFor } from '../src/renderer/src/recording/take-view'
import { outputFrameTimes, outputToSource, timeMapOf } from '../src/renderer/src/recording/timemap'
import type { RecordingTrack } from '../src/renderer/src/recording/track'
import * as compose from '../src/renderer/src/render/compose'
import { fakeContext } from './fake-canvas'
import { output, piece, video } from './recording-scenes'

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
  it('starts at the trim when the playhead is before it', () => {
    const { start, end } = newBoxTime(500, { start: 2000, end: 9000 }, FPS, 10_000)
    expect(start).toBeGreaterThanOrEqual(2000)
    expect(start).toBeLessThan(2000 + FRAME_MS)
    expect(end).toBe(9000)
  })

  it('never starts before the trim when the trim is shorter than the minimum', () => {
    const { start, end } = newBoxTime(2000, { start: 2000, end: 2100 }, FPS, 10_000)
    expect(start).toBeGreaterThanOrEqual(2000)
    expect(end).toBeGreaterThanOrEqual(2100)
    expect(start).toBeLessThan(end)
  })

  it('keeps the minimum where the trim allows it', () => {
    const { start, end } = newBoxTime(5000, { start: 2000, end: 5100 }, FPS, 10_000)
    expect(end - start).toBeGreaterThanOrEqual(MIN_BOX_MS)
    expect(start).toBeGreaterThanOrEqual(2000)
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
