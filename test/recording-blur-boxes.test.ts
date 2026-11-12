import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Redaction } from '../src/renderer/src/app/doc'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { MIN_BOX_MS, newBoxTime, isShownAt, REDACTION_PAD_MS } from '../src/renderer/src/recording/blur-boxes'
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
    expect(newBoxTime(4000, { start: 0, end: 9000 }, FPS)).toEqual({ start: 4000, end: 9000 })
    expect(newBoxTime(8950, { start: 0, end: 9000 }, FPS)).toEqual({ start: 8800, end: 9000 })
    expect(MIN_BOX_MS).toBe(200)
  })

  it('snaps the start down and the end up to the source frame grid', () => {
    const { start, end } = newBoxTime(4005, { start: 0, end: 9005 }, FPS)
    expect(start).toBeCloseTo(4000, 6)
    expect(end).toBeCloseTo(9016.6667, 3)
    expect(start).toBeLessThanOrEqual(4005)
    expect(end).toBeGreaterThanOrEqual(9005)
    expect(Math.abs((end - start) / FRAME_MS - Math.round((end - start) / FRAME_MS))).toBeLessThan(1e-6)
  })
})

describe('boxes in the picture', () => {
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
