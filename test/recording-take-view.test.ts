import { describe, expect, it } from 'vitest'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { buildCameraPath, cameraAt, cameraTargets, type CameraState } from '../src/renderer/src/recording/camera'
import { buildCursorPath, cursorAt, SMOOTHING_MAX_TAU_MS, tiltAt, type CursorFrame, type CursorPath } from '../src/renderer/src/recording/cursor'
import { activeClicks, PRESS, pressScale } from '../src/renderer/src/recording/effects'
import type { RecordingEntry } from '../src/renderer/src/recording/registry'
import { recordingScene } from '../src/renderer/src/recording/scene'
import { DEFAULT_RECORDING, type RecordingDoc } from '../src/renderer/src/recording/settings'
import { cropOf, takeViewFor, type TakeView } from '../src/renderer/src/recording/take-view'
import { outputFrameTimes, outputToSource, wholeTake, type Piece, type Rate } from '../src/renderer/src/recording/timemap'
import type { Click, CursorSample, CursorShape, RecordingTrack } from '../src/renderer/src/recording/track'
import type { Trim } from '../src/renderer/src/recording/trim'
import { moveZoom, segmentsFromEdits, type ZoomEdit } from '../src/renderer/src/recording/zoom-edits'
import { autoZooms } from '../src/renderer/src/recording/zooms'

const frame = { width: 1920, height: 1080 }
const SAMPLE_MS = 8
const SPRING_REACH_IN_TAUS = 30
const piece = (start: number, end: number, rate: Rate = 1, cut = false): Piece => ({ start, end, rate, cut })
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
    [clickOnPath(900), clickOnPath(2500), clickOnPath(4200), clickOnPath(5000), clickOnPath(7600), clickOnPath(8400), clickOnPath(10_400)]))
  const trim = { start: 1003, end: 10_997 }
  const settings = (patch: Partial<RecordingDoc> = {}): RecordingDoc => ({ ...DEFAULT_RECORDING, trim, pieces: wholeTake(12_000), zooms: null, ...patch })

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

  it.each(['calm', 'quick'] as const)('zooms as stage 1 did and moves the camera on stage 1’s zooms (%s)', (speed) => {
    const stage1 = autoZooms(take.track.clicks, frame, trim, speed)
    const stage1Camera = buildCameraPath(cameraTargets(stage1, frame, speed), speed, frame)
    const view = takeViewFor(take, settings({ zoomSpeed: speed }), null)
    expect(stage1).toHaveLength(2)
    expect(view.zooms).toEqual(stage1.map((zoom) => ({ ...zoom, start: zoom.start - trim.start, end: zoom.end - trim.start })))
    for (const o of outputFrameTimes(view.map, 60)) {
      expectSameCamera(cameraAt(view.camera, o), cameraAt(stage1Camera, trim.start + o))
    }
  })

  it('draws the raw cursor where stage 1 did on every exported frame', () => {
    const stage1 = buildCursorPath(take.track, 0, trim.end)
    const view = takeViewFor(take, settings({ smoothing: 0 }), null)
    for (const o of outputFrameTimes(view.map, 60)) {
      expectSameCursor(cursorAt(view.cursor, o, true, view.frame), cursorAt(stage1, trim.start + o, true, frame))
    }
  })

  it.each([0.3, 0.6, 1])('draws the smoothed cursor where stage 1 did, from the first frame until the end nears (smoothing %s)', (smoothing) => {
    const stage1 = buildCursorPath(take.track, smoothing, trim.end)
    const view = takeViewFor(take, settings({ smoothing }), null)
    const smoothingReach = SPRING_REACH_IN_TAUS * smoothing * SMOOTHING_MAX_TAU_MS + SAMPLE_MS
    const compared = outputFrameTimes(view.map, 60).filter((o) => o <= view.map.outputMs - smoothingReach)
    expect(compared[0]).toBe(0)
    for (const o of compared) {
      expectSameCursor(cursorAt(view.cursor, o, true, view.frame), cursorAt(stage1, trim.start + o, true, frame))
    }
  })

  it.each(['ring', 'ripple'] as const)('draws stage 1’s %s effects and presses on every exported frame, the one before the video included', (effect) => {
    const view = takeViewFor(take, settings(), null)
    expect(activeClicks(view.effectClicks, 0, effect, view.frame)).toHaveLength(1)
    for (const o of outputFrameTimes(view.map, 60)) {
      const now = activeClicks(view.effectClicks, o, effect, view.frame)
      const then = activeClicks(take.track.clicks, trim.start + o, effect, frame)
      expect(now.map(({ x, y }) => ({ x, y }))).toEqual(then.map(({ x, y }) => ({ x, y })))
      now.forEach((active, i) => expect(active.progress).toBeCloseTo(then[i].progress, 9))
      expect(pressScale(view.effectClicks, o)).toBeCloseTo(pressScale(take.track.clicks, trim.start + o), 9)
    }
  })

  it.each([0, 0.3, 0.6, 1])('sits on every click at its output time and holds on the last one to the end (smoothing %s)', (smoothing) => {
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

describe('the start of a video after a dragged trim start is stage 1’s', () => {
  const resting = (x: number, y: number, fromMs: number, toMs: number): CursorSample[] =>
    Array.from({ length: Math.floor((toMs - fromMs) / 16) }, (_, i) => ({ t: fromMs + i * 16, x, y, shape: 'arrow' }))
  const trim = { start: 5000, end: 11_000 }
  const settings = (patch: Partial<RecordingDoc> = {}): RecordingDoc => ({ ...DEFAULT_RECORDING, trim, pieces: wholeTake(12_000), zooms: null, ...patch })
  const expectStage1Cursor = (take: RecordingEntry, smoothing: number) => {
    const stage1 = buildCursorPath(take.track, smoothing, trim.end)
    const view = takeViewFor(take, settings({ smoothing }), null)
    for (const o of outputFrameTimes(view.map, 60)) {
      expectSameCursor(cursorAt(view.cursor, o, true, view.frame), cursorAt(stage1, trim.start + o, true, frame))
    }
    return view
  }

  it.each([0, 0.6])('keeps a cursor that was still before it hidden (smoothing %s)', (smoothing) => {
    const still = entryOf('still-before-start', monitorTake(12_000, resting(800, 400, 0, 12_000), []))
    const view = expectStage1Cursor(still, smoothing)
    for (const o of outputFrameTimes(view.map, 60)) expect(cursorAt(view.cursor, o, true, view.frame)).toBeNull()
  })

  it.each([0, 0.6])('fades out a cursor that stopped a second before it (smoothing %s)', (smoothing) => {
    const moving = Array.from({ length: 250 }, (_, i): CursorSample => ({ t: i * 16, x: 200 + i * 4, y: 300, shape: 'arrow' }))
    const stopped = entryOf('stopped-before-start', monitorTake(12_000, [...moving, ...resting(1200, 300, 4000, 12_000)], []))
    const view = expectStage1Cursor(stopped, smoothing)
    expect(cursorAt(view.cursor, 0, true, view.frame)!.opacity).toBe(1)
    expect(cursorAt(view.cursor, 1000, true, view.frame)).toBeNull()
  })

  it('carries on the ring and the press of a click made just before it', () => {
    const click: Click = { t: 4900, x: 800, y: 400, button: 'left', up: 5400 }
    const clicked = entryOf('clicked-before-start', monitorTake(12_000, resting(800, 400, 0, 12_000), [click]))
    const view = expectStage1Cursor(clicked, 0.6)
    expect(view.track.clicks).toEqual([])
    expect(view.zooms).toEqual([])
    expect(activeClicks(view.effectClicks, 0, 'ring', view.frame)).toEqual([{ x: 800, y: 400, progress: 100 / 450 }])
    expect(activeClicks(view.effectClicks, 349, 'ring', view.frame)).toHaveLength(1)
    expect(activeClicks(view.effectClicks, 350, 'ring', view.frame)).toEqual([])
    expect(pressScale(view.effectClicks, 0)).toBeCloseTo(PRESS.scale, 9)
    expect(pressScale(view.effectClicks, 400)).toBeCloseTo(PRESS.scale, 9)
    expect(pressScale(view.effectClicks, 400 + PRESS.ms)).toBe(1)
    for (const o of outputFrameTimes(view.map, 60)) {
      const now = activeClicks(view.effectClicks, o, 'ring', view.frame)
      const then = activeClicks(clicked.track.clicks, trim.start + o, 'ring', frame)
      expect(now.length).toBe(then.length)
      now.forEach((active, i) => expect(active.progress).toBeCloseTo(then[i].progress, 9))
      expect(pressScale(view.effectClicks, o)).toBeCloseTo(pressScale(clicked.track.clicks, trim.start + o), 9)
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
    ({ ...DEFAULT_RECORDING, trim: { start: 1000, end: 11_000 }, pieces: wholeTake(12_000), zooms: null, ...patch })

  it('gives stage 1’s zooms in output time when nothing is cut or sped up', () => {
    const stage1 = autoZooms(clicks, frame, { start: 1000, end: 11_000 }, 'calm').map((z) => ({ ...z, start: z.start - 1000, end: z.end - 1000 }))
    expect(takeViewFor(entry, recording(), null).zooms).toEqual(stage1)
  })

  it('keeps an edge zoom aimed at all its clicks, stored or not, until it is moved', () => {
    const early = { ...entry, track: { ...entry.track, clicks: [click(1200, 900, 500), click(2500, 1000, 560)] } }
    const view = takeViewFor(early, recording(), null)
    expect(view.zooms).toEqual([{ start: 1900, end: 3000, depth: 2.5, focus: { x: 950, y: 530 } }])
    expect(segmentsFromEdits(view.edits, view, 'calm')).toEqual(view.zooms)
    const moved = moveZoom(view.edits, 'auto-0', view.edits[0].start + 100, recording().trim)
    expect(segmentsFromEdits(moved, view, 'calm')[0].focus).toEqual({ x: 1000, y: 560 })
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

  it.each([0, 0.6, 1])('keeps the cursor on both clicks of a double-click inside an 8× stretch (smoothing %s)', (smoothing) => {
    const doubleClicked = { ...entry, track: { ...entry.track, clicks: [click(6000, 700, 500), click(6150, 704, 503)] } }
    const view = takeViewFor(doubleClicked, recording({ smoothing, pieces: [piece(0, 5000), piece(5000, 8000, 8), piece(8000, 12_000)] }), null)
    expect(view.track.clicks.map((c) => c.t)).toEqual([4125, 4143.75])
    for (const kept of view.track.clicks) {
      const at = cursorAt(view.cursor, kept.t, false, view.frame)!
      expect(Math.hypot(at.x - kept.x, at.y - kept.y)).toBeLessThan(0.5)
    }
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
    expect(smoother.camera).toBe(view.camera)
    expect(smoother.cursor).not.toBe(view.cursor)
  })

  it('rebuilds the zooms for a new zoom speed and everything for a new trim, but nothing for equal values', () => {
    const base = recording({ smoothing: 0.4 })
    const view = takeViewFor(entry, base, null)
    const quicker = takeViewFor(entry, { ...base, zoomSpeed: 'quick' }, null)
    expect(quicker.map).toBe(view.map)
    expect(quicker.cursor).toBe(view.cursor)
    expect(quicker.zooms).not.toBe(view.zooms)
    expect(quicker.camera).not.toBe(view.camera)
    const retrimmed = takeViewFor(entry, { ...base, zoomSpeed: 'quick', trim: { start: 1000, end: 10_000 } }, null)
    expect(retrimmed.track).not.toBe(quicker.track)
    expect(retrimmed.zooms).not.toBe(quicker.zooms)
    expect(retrimmed.camera).not.toBe(quicker.camera)
    expect(retrimmed.cursor).not.toBe(quicker.cursor)
    const sameValues = { ...base, zoomSpeed: 'quick' as const, trim: { start: 1000, end: 10_000 }, pieces: wholeTake(12_000) }
    expect(takeViewFor(entry, sameValues, null)).toBe(retrimmed)
    const cropped = takeViewFor(entry, sameValues, { x: 0, y: 120, w: 1920, h: 960 })
    expect(cropped).not.toBe(retrimmed)
    expect(takeViewFor(entry, sameValues, { x: 0, y: 120, w: 1920, h: 960 })).toBe(cropped)
  })

  it('rebuilds only the zooms and the camera for new zoom edits', () => {
    const base = recording({ smoothing: 0.3 })
    const view = takeViewFor(entry, base, null)
    const stored = { ...base, zooms: view.edits }
    const edited = takeViewFor(entry, stored, null)
    expect(edited.track).toBe(view.track)
    expect(edited.cursor).toBe(view.cursor)
    expect(edited.edits).toBe(stored.zooms)
    expect(edited.zooms).not.toBe(view.zooms)
    expect(edited.camera).not.toBe(view.camera)
    expect(takeViewFor(entry, stored, null)).toBe(edited)
    expect(takeViewFor(entry, { ...stored, zooms: [...view.edits] }, null)).not.toBe(edited)
  })

  it('gives the automatic zooms as edits, in source ms and video px', () => {
    const view = takeViewFor(entry, recording(), { x: 0, y: 120, w: 1920, h: 960 })
    expect(view.zooms).toHaveLength(2)
    expect(view.edits).toEqual(view.zooms.map((zoom, i) => ({
      id: `auto-${i}`,
      start: zoom.start + 1000,
      end: zoom.end + 1000,
      depth: zoom.depth,
      aim: 'auto',
      focus: { x: zoom.focus.x, y: zoom.focus.y + 120 }
    })))
  })

  it('aims stored zooms in the cropped frame and moves the camera on them', () => {
    const manual: ZoomEdit = { id: 'mine', start: 4000, end: 6000, depth: 3, aim: 'manual', focus: { x: 1500, y: 300 } }
    const view = takeViewFor(entry, recording({ zooms: [manual] }), { x: 0, y: 120, w: 1920, h: 960 })
    expect(view.edits).toEqual([manual])
    expect(view.zooms).toEqual([{ start: 3000, end: 5000, depth: 3, focus: { x: 1500, y: 180 } }])
    const onStoredZooms = buildCameraPath(cameraTargets(view.zooms, view.frame, 'calm'), 'calm', view.frame)
    for (const t of [1000, 2500, 4000, 5500, 8000]) expect(cameraAt(view.camera, t)).toEqual(cameraAt(onStoredZooms, t))
    expect(cameraAt(view.camera, 4000).depth).toBeGreaterThan(2.9)
  })

  it('turns its automatic zooms into edits and back across a cut, a speed-up and a crop', () => {
    const edited = recording({ pieces: [piece(0, 4000), piece(4000, 6000, 1, true), piece(6000, 8500, 4), piece(8500, 12_000)] })
    const view = takeViewFor(entry, edited, { x: 40, y: 20, w: 1800, h: 1000 })
    expect(view.zooms.map(({ start, end }) => [start, end])).toEqual([[1900, 4225]])
    expect(view.edits.map(({ start, end }) => [start, end])).toEqual([[2900, 9100]])
    const back = segmentsFromEdits(view.edits, view, edited.zoomSpeed)
    expect(back).toHaveLength(1)
    expect(back[0].start).toBeCloseTo(view.zooms[0].start, 6)
    expect(back[0].end).toBeCloseTo(view.zooms[0].end, 6)
    expect(back[0].depth).toBe(view.zooms[0].depth)
    expect(back[0].focus).toEqual(view.zooms[0].focus)
    expect(back[0].follow).toBeUndefined()
  })

  it('keeps the camera continuous across a cut and a speed-up', () => {
    const seams = [
      recording({ pieces: [piece(0, 4000), piece(4000, 6000, 1, true), piece(6000, 12_000)] }),
      recording({ pieces: [piece(0, 5000), piece(5000, 8000, 4), piece(8000, 12_000)] })
    ]
    for (const edited of seams) {
      const view = takeViewFor(entry, edited, null)
      let previous = cameraAt(view.camera, 0)
      for (let t = 1; t <= view.map.outputMs; t++) {
        const current = cameraAt(view.camera, t)
        expect(Math.abs(current.depth - previous.depth)).toBeLessThan(0.01)
        expect(Math.hypot(current.focus.x - previous.focus.x, current.focus.y - previous.focus.y)).toBeLessThan(5)
        previous = current
      }
    }
  })

  it.each([0, 0.6, 1])('keeps the cursor on clicks on both sides of a cut (smoothing %s)', (smoothing) => {
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
    ({ ...DEFAULT_RECORDING, smoothing: 0, trim: { start: 0, end: 10_000 }, pieces: wholeTake(10_000), zooms: null, ...patch })
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

describe('the cursor at a cut’s seam', () => {
  const along = (fromMs: number, toMs: number, xAt: (t: number) => number): CursorSample[] =>
    Array.from({ length: (toMs - fromMs) / 16 }, (_, i) => ({ t: fromMs + i * 16, x: xAt(fromMs + i * 16), y: 400, shape: 'arrow' }))
  const movedInTheCut = entryOf('moved-in-the-cut', monitorTake(12_000, [
    ...along(0, 4096, () => 500),
    ...along(4096, 5904, (t) => 500 + (730 * (t - 4096)) / 1808),
    ...along(5904, 12_000, () => 1230)
  ], []))
  const seamMs = 3000
  const cutOut = (smoothing: number, trim = { start: 1000, end: 11_000 }): RecordingDoc =>
    ({ ...DEFAULT_RECORDING, smoothing, trim, pieces: [piece(0, 4000), piece(4000, 6000, 1, true), piece(6000, 12_000)], zooms: null })

  it.each([0, 0.6, 1])('jumps with the cut instead of gliding across it (smoothing %s)', (smoothing) => {
    const view = takeViewFor(movedInTheCut, cutOut(smoothing), null)
    for (const o of outputFrameTimes(view.map, 60)) {
      expect(cursorAt(view.cursor, o, false, view.frame)!.x).toBeCloseTo(o < seamMs ? 500 : 1230, 6)
    }
  })

  it.each([0, 0.6])('keeps a hidden still cursor hidden across a cut it moved in (smoothing %s)', (smoothing) => {
    const view = takeViewFor(movedInTheCut, cutOut(smoothing), null)
    const afterItHid = outputFrameTimes(view.map, 60).filter((o) => o >= 1000)
    for (const o of afterItHid) expect(cursorAt(view.cursor, o, true, view.frame)).toBeNull()
  })

  it.each([0, 0.6])('shows a hidden cursor that moves right after a cut with the cut, not before it (smoothing %s)', (smoothing) => {
    const movesOnAfterTheCut = entryOf('moves-on-after-the-cut', monitorTake(12_000, [
      ...along(0, 4096, () => 500),
      ...along(4096, 5904, (t) => 500 + (730 * (t - 4096)) / 1808),
      ...along(5904, 12_000, (t) => 1230 + Math.min(Math.max(t - 6000, 0), 1000) / 2)
    ], []))
    const view = takeViewFor(movesOnAfterTheCut, cutOut(smoothing), null)
    const beforeTheCut = outputFrameTimes(view.map, 60).filter((o) => o >= 1000 && o < seamMs)
    for (const o of beforeTheCut) expect(cursorAt(view.cursor, o, true, view.frame)).toBeNull()
    expect(cursorAt(view.cursor, seamMs, true, view.frame)!.opacity).toBe(1)
  })

  it.each([0, 0.6, 1])('stands upright through a jump (smoothing %s)', (smoothing) => {
    const view = takeViewFor(movedInTheCut, cutOut(smoothing), null)
    for (const o of outputFrameTimes(view.map, 60)) expect(tiltAt(view.cursor, o, 1)).toBeCloseTo(0, 9)
  })

  it.each([0.6, 1])('reads nothing past the cut before it, as at the end of the video (smoothing %s)', (smoothing) => {
    const wandered = entryOf('wandered-through-the-cut', monitorTake(12_000, wandering(12_000, SAMPLE_MS), []))
    const cut = takeViewFor(wandered, cutOut(smoothing), null)
    const endingAtTheCut = takeViewFor(wandered, cutOut(smoothing, { start: 1000, end: 4000 }), null)
    for (const o of outputFrameTimes(endingAtTheCut.map, 60)) {
      expectSameCursor(cursorAt(cut.cursor, o, true, cut.frame), cursorAt(endingAtTheCut.cursor, o, true, endingAtTheCut.frame))
    }
  })

  it.each([0, 0.6, 1])('has a finite place and speed everywhere across cuts and speed-ups (smoothing %s)', (smoothing) => {
    const clicked = entryOf('clicked-across-edits', monitorTake(12_000, wandering(12_000, SAMPLE_MS), [3990, 6000, 7000].map(clickOnPath)))
    const view = takeViewFor(clicked, { ...cutOut(smoothing), pieces: [piece(0, 4000), piece(4000, 6000, 1, true), piece(6000, 8000, 8), piece(8000, 12_000)] }, null)
    for (const values of [view.cursor.x, view.cursor.y, view.cursor.vx, view.cursor.vy]) expect(values.every(Number.isFinite)).toBe(true)
    for (const o of outputFrameTimes(view.map, 60)) expect(Number.isFinite(tiltAt(view.cursor, o, 1))).toBe(true)
  })
})

describe('the cursor gliding into the end of the video and into a cut', () => {
  const pxPerMs = 1
  const xAt = (sourceMs: number) => 60 + pxPerMs * sourceMs
  const steadyMove = entryOf('steady-move', monitorTake(1800,
    Array.from({ length: 1800 / SAMPLE_MS + 1 }, (_, i): CursorSample => ({ t: i * SAMPLE_MS, x: xAt(i * SAMPLE_MS), y: 540, shape: 'arrow' })), []))
  const expectOnPathAtFullSpeed = (path: CursorPath, index: number, sourceMs: number) => {
    expect(Math.abs(path.x[index] - xAt(sourceMs))).toBeLessThan(0.1)
    expect(path.vx[index]).toBeCloseTo(pxPerMs, 2)
  }

  it.each([0.3, 0.6, 1])('reaches a manual trim end at full speed on its path (smoothing %s)', (smoothing) => {
    const view = takeViewFor(steadyMove, { ...DEFAULT_RECORDING, smoothing, trim: { start: 0, end: 1500 }, pieces: wholeTake(1800), zooms: null }, null)
    expectOnPathAtFullSpeed(view.cursor, view.cursor.t.length - 1, 1500)
    for (const o of outputFrameTimes(view.map, 60)) expect(Math.abs(cursorAt(view.cursor, o, false, view.frame)!.x - xAt(o))).toBeLessThan(0.1)
  })

  it.each([0.3, 0.6, 1])('reaches a cut at full speed on its path and leaves it the same way (smoothing %s)', (smoothing) => {
    const view = takeViewFor(steadyMove, { ...DEFAULT_RECORDING, smoothing, trim: { start: 0, end: 1800 },
      pieces: [piece(0, 600), piece(600, 1200, 1, true), piece(1200, 1800)], zooms: null }, null)
    const seam = view.cursor.t.indexOf(600)
    expect(view.cursor.t[seam + 1]).toBe(600)
    expectOnPathAtFullSpeed(view.cursor, seam, 600)
    expectOnPathAtFullSpeed(view.cursor, seam + 1, 1200)
    for (const o of outputFrameTimes(view.map, 60)) {
      expect(Math.abs(cursorAt(view.cursor, o, false, view.frame)!.x - xAt(o < 600 ? o : o + 600))).toBeLessThan(0.1)
    }
  })
})

describe('cropOf', () => {
  it('is the whole video without a crop, and the crop otherwise', () => {
    expect(cropOf(null, frame)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
    expect(cropOf({ x: 0, y: 120, w: 1920, h: 960 }, frame)).toEqual({ x: 0, y: 120, w: 1920, h: 960 })
  })
})
