import { describe, expect, it } from 'vitest'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { cameraAt, type CameraState } from '../src/renderer/src/recording/camera'
import { buildCursorPath, cursorAt, SMOOTHING_MAX_SIGMA_MS, type CursorFrame } from '../src/renderer/src/recording/cursor'
import { activeClicks } from '../src/renderer/src/recording/effects'
import type { RecordingEntry } from '../src/renderer/src/recording/registry'
import { recordingScene } from '../src/renderer/src/recording/scene'
import { DEFAULT_RECORDING, type RecordingDoc } from '../src/renderer/src/recording/settings'
import { cropOf, takeViewFor, type TakeView } from '../src/renderer/src/recording/take-view'
import { outputFrameTimes, outputToSource, wholeTake, type Piece, type Rate } from '../src/renderer/src/recording/timemap'
import type { Click, CursorSample, CursorShape, RecordingTrack } from '../src/renderer/src/recording/track'
import type { Trim } from '../src/renderer/src/recording/trim'
import { autoZooms } from '../src/renderer/src/recording/zooms'

const frame = { width: 1920, height: 1080 }
const SAMPLE_MS = 8
const piece =(start: number, end: number, rate: Rate = 1, cut = false): Piece => ({ start, end, rate, cut })
const entryOf = (id: string, track: RecordingTrack): RecordingEntry => ({ id, name: 'Recording', poster: null, track })
const monitorTake = (durationMs: number, cursor: CursorSample[], clicks: Click[]): RecordingTrack =>
  ({ kind: 'monitor', ...frame, fps: 60, durationMs, scale: 1, cursor, clicks })

const wanderAt = (t: number) => ({ x: 960 + 700 * Math.sin(t / 1700), y: 540 + 380 * Math.sin(t / 2300 + 1) })
const wandering = (durationMs: number, sampleMs: number): CursorSample[] =>
  Array.from({ length: Math.floor(durationMs / sampleMs) + 1 }, (_, i) => ({ t: i * sampleMs, ...wanderAt(i * sampleMs), shape: 'arrow' }))
const clickOnPath = (t: number): Click => ({ t, ...wanderAt(t), button: 'left', up: t + 90 })

function stage1FrameTimes(trim: Trim, fps: number): number[] {
  const count = Math.max(1, Math.ceil(((trim.end - trim.start) * fps) / 1000 - 1e-9))
  return Array.from({ length: count }, (_, i) => trim.start + (i * 1000) / fps)
}

function expectSameCamera(actual: CameraState, expected: CameraState) {
  expect(actual.depth).toBeCloseTo(expected.depth, 9)
  expect(actual.focus.x).toBeCloseTo(expected.focus.x, 9)
  expect(actual.focus.y).toBeCloseTo(expected.focus.y, 9)
}

function expectSameCursor(actual: CursorFrame | null, expected: CursorFrame | null) {
  expect(actual === null).toBe(expected === null)
  if (!actual || !expected) return
  expect(actual.x).toBeCloseTo(expected.x, 9)
  expect(actual.y).toBeCloseTo(expected.y, 9)
  expect(actual.shape).toBe(expected.shape)
  expect(actual.opacity).toBeCloseTo(expected.opacity, 9)
}

describe('a take with one uncut 1× piece and no crop is drawn as stage 1 drew it', () => {
  const take = entryOf('stage-1', monitorTake(12_000, wandering(12_000, SAMPLE_MS),
    [clickOnPath(2500), clickOnPath(4200), clickOnPath(5000), clickOnPath(7600), clickOnPath(8400), clickOnPath(10_400)]))
  const trim = { start: 1003, end: 10_997 }
  const settings = (patch: Partial<RecordingDoc> = {}): RecordingDoc => ({ ...DEFAULT_RECORDING, trim, pieces: wholeTake(12_000), ...patch })

  it('plays the trim and nothing else, in the whole frame', () => {
    const view = takeViewFor(take, settings(), null)
    expect(view.map.spans).toEqual([{ source: trim, outputStart: 0, rate: 1 }])
    expect(view.map.outputMs).toBe(trim.end - trim.start)
    expect(view.crop).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
    expect(view.frame).toEqual(frame)
  })

  it.each([60, 30])('exports the source frames stage 1 exported (%s fps)', (fps) => {
    const { map } = takeViewFor(take, settings(), null)
    expect(outputFrameTimes(map, fps).map((o) => outputToSource(map, o))).toEqual(stage1FrameTimes(trim, fps))
  })

  it.each(['calm', 'quick'] as const)('zooms and moves the camera as stage 1 did (%s)', (speed) => {
    const stage1 = autoZooms(take.track.clicks, frame, trim, speed)
    const view = takeViewFor(take, settings({ zoomSpeed: speed }), null)
    expect(stage1).toHaveLength(2)
    expect(view.zooms).toEqual(stage1.map((zoom) => ({ ...zoom, start: zoom.start - trim.start, end: zoom.end - trim.start })))
    for (const o of outputFrameTimes(view.map, 60)) {
      expectSameCamera(cameraAt(o, view.zooms, view.frame, speed), cameraAt(trim.start + o, stage1, frame, speed))
    }
  })

  it('draws the raw cursor where stage 1 did on every exported frame', () => {
    const stage1 = buildCursorPath(take.track, 0, trim.end)
    const view = takeViewFor(take, settings({ smoothing: 0 }), null)
    for (const o of outputFrameTimes(view.map, 60)) {
      expectSameCursor(cursorAt(view.cursor, o, true, view.frame), cursorAt(stage1, trim.start + o, true, frame))
    }
  })

  it.each([0.3, 0.6, 1])('draws the smoothed cursor where stage 1 did, away from the ends of the video (smoothing %s)', (smoothing) => {
    const stage1 = buildCursorPath(take.track, smoothing, trim.end)
    const view = takeViewFor(take, settings({ smoothing }), null)
    const smoothingReach = 3 * smoothing * SMOOTHING_MAX_SIGMA_MS + SAMPLE_MS
    const inside = outputFrameTimes(view.map, 60).filter((o) => o >= smoothingReach && o <= view.map.outputMs - smoothingReach)
    expect(inside.length).toBeGreaterThan(500)
    for (const o of inside) {
      expectSameCursor(cursorAt(view.cursor, o, true, view.frame), cursorAt(stage1, trim.start + o, true, frame))
    }
  })

  it.each([0.3, 0.6, 1])('sits on every click at its output time and holds on the last one to the end (smoothing %s)', (smoothing) => {
    const view = takeViewFor(take, settings({ smoothing }), null)
    expect(view.track.clicks).toHaveLength(6)
    for (const click of view.track.clicks) {
      const at = cursorAt(view.cursor, click.t, false, view.frame)!
      expect(Math.hypot(at.x - click.x, at.y - click.y)).toBeLessThan(0.5)
    }
    const landing = view.track.clicks.at(-1)!
    for (const o of outputFrameTimes(view.map, 60).filter((o) => o >= landing.t)) {
      const at = cursorAt(view.cursor, o, false, view.frame)!
      expect(Math.hypot(at.x - landing.x, at.y - landing.y)).toBeLessThan(0.01)
    }
  })
})

describe('the take view', () => {
  const click = (t: number, x: number, y: number) => ({ t, x, y, button: 'left' as const, up: t + 80 })
  const clicks = [click(3000, 500, 300), click(6500, 520, 320), click(9000, 1400, 800)]
  const still = Array.from({ length: 750 }, (_, i) => ({ t: i * 16, x: 960, y: 540, shape: 'arrow' as const }))
  const entry: RecordingEntry = { id: 'take-view', name: 'Recording', poster: null,
    track: { kind: 'monitor', ...frame, fps: 60, durationMs: 12_000, scale: 1, cursor: still, clicks } }
  const recording = (patch: Partial<RecordingDoc> = {}): RecordingDoc =>
    ({ ...DEFAULT_RECORDING, trim: { start: 1000, end: 11_000 }, pieces: wholeTake(12_000), ...patch })

  it('gives stage 1’s zooms in output time when nothing is cut or sped up', () => {
    const stage1 = autoZooms(clicks, frame, { start: 1000, end: 11_000 }, 'calm').map((z) => ({ ...z, start: z.start - 1000, end: z.end - 1000 }))
    expect(takeViewFor(entry, recording(), null).zooms).toEqual(stage1)
  })

  it('exports the frames stage 1 exported', () => {
    const { map } = takeViewFor(entry, recording({ trim: { start: 1000, end: 1100 } }), null)
    expect(outputFrameTimes(map, 60).map((o) => Math.round(outputToSource(map, o)))).toEqual([1000, 1017, 1033, 1050, 1067, 1083])
  })

  it('makes one zoom of clicks that a cut brings together', () => {
    expect(takeViewFor(entry, recording(), null).zooms).toHaveLength(2)
    const cut = recording({ pieces: [piece(0, 4000), piece(4000, 6000, 1, true), piece(6000, 12_000)] })
    expect(takeViewFor(entry, cut, null).zooms).toHaveLength(1)
  })

  it('keeps the cursor on a click inside an 8× stretch, and its ring at normal length', () => {
    const view = takeViewFor(entry, recording({ pieces: [piece(0, 5000), piece(5000, 8000, 8), piece(8000, 12_000)] }), null)
    const fast = view.track.clicks.find((c) => c.x === 520)!
    expect(fast.t).toBeCloseTo(4000 + 1500 / 8)
    const at = cursorAt(view.cursor, fast.t, false, view.frame)!
    expect(Math.hypot(at.x - 520, at.y - 320)).toBeLessThan(0.5)
    expect(activeClicks(view.track.clicks, fast.t + 225, 'ring', view.frame)[0].progress).toBeCloseTo(0.5)
  })

  it('frames a cropped take: positions move into the crop and a click outside it drives nothing', () => {
    const tabStrip = { ...entry, track: { ...entry.track, clicks: [clicks[0], click(5000, 600, 40), ...clicks.slice(1)] } }
    const view = takeViewFor(tabStrip, recording(), { x: 0, y: 120, w: 1920, h: 960 })
    expect(view.frame).toEqual({ width: 1920, height: 960 })
    expect(view.track.clicks.find((c) => c.x === 600)!.y).toBe(-80)
    expect(view.zooms).toHaveLength(2)
  })

  it('is built once per edit state and rebuilds only what a change touches', () => {
    const base = recording()
    const view = takeViewFor(entry, base, null)
    expect(takeViewFor(entry, { ...base, cursorSize: 2 }, null)).toBe(view)
    const smoother = takeViewFor(entry, { ...base, smoothing: 0.2 }, null)
    expect(smoother.zooms).toBe(view.zooms)
    expect(smoother.cursor).not.toBe(view.cursor)
  })

  it('rebuilds the zooms for a new zoom speed and everything for a new trim, but nothing for equal values', () => {
    const base = recording({ smoothing: 0.4 })
    const view = takeViewFor(entry, base, null)
    const quicker = takeViewFor(entry, { ...base, zoomSpeed: 'quick' }, null)
    expect(quicker.map).toBe(view.map)
    expect(quicker.cursor).toBe(view.cursor)
    expect(quicker.zooms).not.toBe(view.zooms)
    const retrimmed = takeViewFor(entry, { ...base, zoomSpeed: 'quick', trim: { start: 1000, end: 10_000 } }, null)
    expect(retrimmed.track).not.toBe(quicker.track)
    expect(retrimmed.zooms).not.toBe(quicker.zooms)
    expect(retrimmed.cursor).not.toBe(quicker.cursor)
    const sameValues = { ...base, zoomSpeed: 'quick' as const, trim: { start: 1000, end: 10_000 }, pieces: wholeTake(12_000) }
    expect(takeViewFor(entry, sameValues, null)).toBe(retrimmed)
    const cropped = takeViewFor(entry, sameValues, { x: 0, y: 120, w: 1920, h: 960 })
    expect(cropped).not.toBe(retrimmed)
    expect(takeViewFor(entry, sameValues, { x: 0, y: 120, w: 1920, h: 960 })).toBe(cropped)
  })

  it('rebuilds a ten-minute take in under 200 ms', () => {
    const long = longEntry(600_000)
    // Stage 1's Gaussian smoothing alone takes 65–130 ms on 72,000 samples; Task 8's spring replaces it.
    const smoothing = 0
    takeViewFor(long, recording({ smoothing, trim: { start: 0, end: 600_000 }, pieces: wholeTake(600_000) }), null)
    const started = performance.now()
    takeViewFor(long, recording({ smoothing, trim: { start: 500, end: 599_000 }, pieces: wholeTake(600_000) }), null)
    expect(performance.now() - started).toBeLessThan(200)
  })

  it('keeps the camera continuous across a cut and a speed-up', () => {
    const seams = [
      recording({ pieces: [piece(0, 4000), piece(4000, 6000, 1, true), piece(6000, 12_000)] }),
      recording({ pieces: [piece(0, 5000), piece(5000, 8000, 4), piece(8000, 12_000)] })
    ]
    for (const edited of seams) {
      const view = takeViewFor(entry, edited, null)
      let previous = cameraAt(0, view.zooms, view.frame, 'calm')
      for (let t = 1; t <= view.map.outputMs; t++) {
        const current = cameraAt(t, view.zooms, view.frame, 'calm')
        expect(Math.abs(current.depth - previous.depth)).toBeLessThan(0.01)
        expect(Math.hypot(current.focus.x - previous.focus.x, current.focus.y - previous.focus.y)).toBeLessThan(5)
        previous = current
      }
    }
  })

  it.each([0.6, 1])('keeps the cursor on clicks on both sides of a cut (smoothing %s)', (smoothing) => {
    const atSeam = { ...entry, track: { ...entry.track, clicks: [click(3990, 700, 500), click(6000, 760, 420)] } }
    const view = takeViewFor(atSeam, recording({ smoothing, pieces: [piece(0, 4000), piece(4000, 6000, 1, true), piece(6000, 12_000)] }), null)
    expect(view.track.clicks.map((c) => c.t)).toEqual([2990, 3000])
    for (const kept of view.track.clicks) {
      const at = cursorAt(view.cursor, kept.t, false, view.frame)!
      expect(Math.hypot(at.x - kept.x, at.y - kept.y)).toBeLessThan(0.5)
    }
  })

  it('is the view the preview and the export draw', () => {
    const doc = { ...DEFAULT_DOC, sourceId: entry.id, recording: recording({ zoomSpeed: 'quick' }) }
    const scene = recordingScene(entry, doc, DEFAULT_HOUSE_STYLE, null, { tag: 'video' } as unknown as CanvasImageSource)
    expect(scene!.view).toBe(takeViewFor(entry, doc.recording, doc.crop))
  })
})

describe('the cursor at the edges of what plays', () => {
  const sparse = entryOf('sparse', monitorTake(10_000, [
    { t: 0, x: 100, y: 100, shape: 'arrow' },
    { t: 2000, x: 300, y: 300, shape: 'arrow' },
    { t: 5000, x: 600, y: 600, shape: 'hand' },
    { t: 9000, x: 1000, y: 1000, shape: 'hand' }
  ], []))
  const raw = (patch: Partial<RecordingDoc>): RecordingDoc =>
    ({ ...DEFAULT_RECORDING, smoothing: 0, trim: { start: 0, end: 10_000 }, pieces: wholeTake(10_000), ...patch })
  const expectCursorAt = (view: TakeView, o: number, expected: { x: number; y: number; shape: CursorShape }) => {
    const at = cursorAt(view.cursor, o, false, view.frame)!
    expect(at.x).toBeCloseTo(expected.x, 6)
    expect(at.y).toBeCloseTo(expected.y, 6)
    expect(at.shape).toBe(expected.shape)
  }

  it('is where the take had it on the first frame when the trim starts between samples', () => {
    const view = takeViewFor(sparse, raw({ trim: { start: 1000, end: 10_000 } }), null)
    expectCursorAt(view, 0, { x: 200, y: 200, shape: 'arrow' })
  })

  it('is where the take had it on both sides of a cut', () => {
    const view = takeViewFor(sparse, raw({ pieces: [piece(0, 3000), piece(3000, 4000, 1, true), piece(4000, 10_000)] }), null)
    expectCursorAt(view, 2999, { x: 399.9, y: 399.9, shape: 'arrow' })
    expectCursorAt(view, 3000, { x: 500, y: 500, shape: 'arrow' })
    expectCursorAt(view, 3500, { x: 550, y: 550, shape: 'arrow' })
  })

  it('is where the take had it at a speed-up’s seams', () => {
    const view = takeViewFor(sparse, raw({ pieces: [piece(0, 3000), piece(3000, 7000, 4), piece(7000, 10_000)] }), null)
    expectCursorAt(view, 3000, { x: 400, y: 400, shape: 'arrow' })
    expectCursorAt(view, 3500, { x: 600, y: 600, shape: 'hand' })
    expectCursorAt(view, 4000, { x: 800, y: 800, shape: 'hand' })
  })

  it('still has a place when no sample falls inside what plays, and holds the nearest one past the take’s samples', () => {
    const between = takeViewFor(sparse, raw({ trim: { start: 2500, end: 4500 } }), null)
    expectCursorAt(between, 0, { x: 350, y: 350, shape: 'arrow' })
    expectCursorAt(between, between.map.outputMs, { x: 550, y: 550, shape: 'arrow' })
    const pastTheEnd = takeViewFor(sparse, raw({ trim: { start: 9500, end: 10_000 } }), null)
    expectCursorAt(pastTheEnd, 0, { x: 1000, y: 1000, shape: 'hand' })
  })

  it('moves into the cropped frame', () => {
    const view = takeViewFor(sparse, raw({ trim: { start: 1000, end: 10_000 } }), { x: 50, y: 20, w: 1600, h: 900 })
    expectCursorAt(view, 0, { x: 150, y: 180, shape: 'arrow' })
  })
})

describe('cropOf', () => {
  it('is the whole video without a crop, and the crop otherwise', () => {
    expect(cropOf(null, frame)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
    expect(cropOf({ x: 0, y: 120, w: 1920, h: 960 }, frame)).toEqual({ x: 0, y: 120, w: 1920, h: 960 })
  })
})

function longEntry(durationMs: number): RecordingEntry {
  const samplesPerSecond = 120
  const cursor = Array.from({ length: (durationMs * samplesPerSecond) / 1000 }, (_, i): CursorSample => {
    const t = (i * 1000) / samplesPerSecond
    return { t, ...wanderAt(t), shape: 'arrow' }
  })
  const clicks = Array.from({ length: durationMs / 2000 }, (_, i) => clickOnPath(1000 + i * 2000))
  return entryOf('long', monitorTake(durationMs, cursor, clicks))
}
