import { describe, expect, it } from 'vitest'
import { cameraAt, type CameraState } from '../src/renderer/src/recording/camera'
import { cursorAt } from '../src/renderer/src/recording/cursor'
import { activeClicks } from '../src/renderer/src/recording/effects'
import type { RecordingEntry } from '../src/renderer/src/recording/registry'
import { DEFAULT_RECORDING, recordingDocFor, type RecordingDoc } from '../src/renderer/src/recording/settings'
import { takeViewFor } from '../src/renderer/src/recording/take-view'
import { outputFrameTimes, outputToSource, wholeTake } from '../src/renderer/src/recording/timemap'
import { isShownClick, stopClickOf, withoutStopClick, type Click, type CursorSample, type RecordingTrack } from '../src/renderer/src/recording/track'
import { materialize, segmentsFromEdits } from '../src/renderer/src/recording/zoom-edits'

const frame = { width: 1920, height: 1080 }
const SAMPLE_MS = 8
const FPS = 60
const wide = { depth: 1, focus: { x: 960, y: 540 } }

interface Spot { x: number; y: number }

const search: Spot = { x: 480, y: 300 }
const filter: Spot = { x: 520, y: 320 }
const next: Spot = { x: 1000, y: 700 }
const taskbarButton: Spot = { x: 900, y: 1060 }
const thumbnail: Spot = { x: 900, y: 910 }

function glide(from: Spot, to: Spot, startMs: number, endMs: number): CursorSample[] {
  const samples: CursorSample[] = []
  for (let t = startMs; t < endMs; t += SAMPLE_MS) {
    const progress = (t - startMs) / (endMs - startMs)
    samples.push({ t, x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress, shape: 'arrow' })
  }
  return samples
}

const rest = (at: Spot, startMs: number, endMs: number) => glide(at, at, startMs, endMs)
const leftClick = (t: number, at: Spot): Click => ({ t, ...at, button: 'left', up: t + 90 })

// The last second starts one settle time into the zoom-out, which starts from the tail of the zoom-in: 2%, give or take a hair.
const expectWithinTwoPercentOfWide = (camera: CameraState, zoomDepth: number) =>
  expect(Math.log(camera.depth)).toBeLessThanOrEqual(1.001 * 0.02 * Math.log(zoomDepth))

const work = [
  ...glide({ x: 300, y: 200 }, search, 0, 1200),
  ...glide(search, filter, 1200, 2400),
  ...glide(filter, next, 2400, 5800)
]
const workClicks = [leftClick(1200, search), leftClick(2400, filter), leftClick(6000, next)]
const lookAtResult = { startMs: 5800, endMs: 8400 }

const track = (cursor: CursorSample[], clicks: Click[], durationMs: number): RecordingTrack =>
  ({ kind: 'monitor', ...frame, fps: FPS, durationMs, scale: 1, cursor, clicks })

const entryOf = (take: RecordingTrack): RecordingEntry => ({ id: 'realistic-take', name: 'Recording', poster: null, track: take })

const takes = {
  'a taskbar stop': {
    stoppedBy: 'window' as const,
    raw: track(
      [
        ...work,
        ...rest(next, lookAtResult.startMs, lookAtResult.endMs),
        ...glide(next, taskbarButton, lookAtResult.endMs, 8900),
        ...rest(taskbarButton, 8900, 9100)
      ],
      [...workClicks, { t: 8900, ...taskbarButton, button: 'left', up: null }],
      9100
    )
  },
  'a taskbar stop after waiting on the button': {
    stoppedBy: 'window' as const,
    raw: track(
      [
        ...work,
        ...rest(next, lookAtResult.startMs, lookAtResult.endMs),
        ...glide(next, taskbarButton, lookAtResult.endMs, 8900),
        ...rest(taskbarButton, 8900, 9700)
      ],
      [...workClicks, { t: 9500, ...taskbarButton, button: 'left', up: null }],
      9700
    )
  },
  'a taskbar stop with the cursor moving away before the take ended': {
    stoppedBy: 'window' as const,
    raw: track(
      [
        ...work,
        ...rest(next, lookAtResult.startMs, lookAtResult.endMs),
        ...glide(next, taskbarButton, lookAtResult.endMs, 8900),
        ...rest(taskbarButton, 8900, 9500),
        ...glide(taskbarButton, { x: 900, y: 700 }, 9500, 9700)
      ],
      [...workClicks, { t: 9500, ...taskbarButton, button: 'left', up: null }],
      9700
    )
  },
  'a taskbar stop on the button’s thumbnail': {
    stoppedBy: 'window' as const,
    raw: track(
      [
        ...work,
        ...rest(next, lookAtResult.startMs, lookAtResult.endMs),
        ...glide(next, taskbarButton, lookAtResult.endMs, 8900),
        ...rest(taskbarButton, 8900, 9500),
        ...glide(taskbarButton, thumbnail, 9500, 9650),
        ...rest(thumbnail, 9650, 9850)
      ],
      [...workClicks, { t: 9650, ...thumbnail, button: 'left', up: null }],
      9850
    )
  },
  'a shortcut stop': {
    stoppedBy: 'shortcut' as const,
    raw: track([...work, ...rest(next, lookAtResult.startMs, 8600)], workClicks, 8600)
  }
}

describe.each(Object.entries(takes))('a realistic take ended by %s', (_name, { stoppedBy, raw }) => {
  const clean = withoutStopClick(raw, stoppedBy)
  const recording = recordingDocFor(clean, null, stopClickOf(raw, stoppedBy))
  const viewWith = (patch: Partial<RecordingDoc> = {}) => takeViewFor(entryOf(clean), { ...recording, ...patch }, null)
  const { map } = viewWith()
  const exportedFrames = outputFrameTimes(map, FPS)

  it('ends the video when the look at the result ends', () => {
    expect(recording.trim).toEqual({ start: 0, end: lookAtResult.endMs })
    expect(map.outputMs).toBe(lookAtResult.endMs)
    expect(outputToSource(map, map.outputMs)).toBe(lookAtResult.endMs)
  })

  it('shows no click on the taskbar or its thumbnail', () => {
    const atTaskbar = (spot: Spot) => spot.y >= thumbnail.y
    const view = viewWith()
    expect(clean.clicks.some(atTaskbar)).toBe(false)
    expect(view.track.clicks.some(atTaskbar)).toBe(false)
    for (const t of exportedFrames) expect(activeClicks(view.track.clicks, t, 'ring', view.frame).some(atTaskbar)).toBe(false)
  })

  it('marks the clicks with rings and zooms on the Clip row, and no others', () => {
    const workClickTimes = workClicks.map((click) => click.t)
    expect(clean.clicks.filter((click) => isShownClick(click, frame)).map((click) => click.t)).toEqual(workClickTimes)
    const view = viewWith()
    const drivingClicks = view.track.clicks.filter((click) => isShownClick(click, view.frame))
    expect(drivingClicks.map((click) => outputToSource(view.map, click.t))).toEqual(workClickTimes)
  })

  it.each(['calm', 'quick'] as const)('zooms on the real clicks only and is wide for the first and last second (%s)', (speed) => {
    const view = viewWith({ zoomSpeed: speed })
    expect(view.zooms.map(({ depth, focus }) => ({ depth, focus }))).toEqual([
      { depth: 2.5, focus: { x: 500, y: 310 } },
      { depth: 2.5, focus: next }
    ])
    const lastZoomDepth = view.zooms.at(-1)!.depth
    for (const t of exportedFrames.filter((t) => t <= 1000)) expect(cameraAt(view.camera, t)).toEqual(wide)
    for (const t of exportedFrames.filter((t) => t >= view.map.outputMs - 1000)) expectWithinTwoPercentOfWide(cameraAt(view.camera, t), lastZoomDepth)
    expectWithinTwoPercentOfWide(cameraAt(view.camera, exportedFrames.at(-1)!), lastZoomDepth)
  })

  it.each(['calm', 'quick'] as const)('keeps its automatic zooms and camera exactly once the first edit stores them (%s)', (speed) => {
    const automatic = viewWith({ zoomSpeed: speed })
    expect(segmentsFromEdits(automatic.edits, automatic, speed)).toEqual(automatic.zooms)
    let n = 0
    const stored = viewWith({ zoomSpeed: speed, zooms: materialize(automatic.edits, () => `zoom-${++n}`).edits })
    expect(stored.zooms).toEqual(automatic.zooms)
    for (const t of exportedFrames) expect(cameraAt(stored.camera, t)).toEqual(cameraAt(automatic.camera, t))
  })
})

describe('the end of a video stopped from the taskbar reads only what plays', () => {
  const { stoppedBy, raw } = takes['a taskbar stop']
  const clean = withoutStopClick(raw, stoppedBy)
  const recording = recordingDocFor(clean, null, stopClickOf(raw, stoppedBy))
  const viewWith = (patch: Partial<RecordingDoc>) => takeViewFor(entryOf(clean), { ...recording, ...patch }, null)

  it.each([0.6, 1])('keeps the cursor hidden after it fades out, though the trip to the taskbar follows (smoothing %s)', (smoothing) => {
    const view = viewWith({ smoothing, hideWhenStill: true })
    expect(view.map.spans).toEqual([{ source: { start: 0, end: lookAtResult.endMs }, outputStart: 0, rate: 1 }])
    const frames = outputFrameTimes(view.map, FPS)
    const lastClick = workClicks.at(-1)!
    const hiddenFrom = frames.findIndex((t) => t > lastClick.t && cursorAt(view.cursor, t, true, view.frame) === null)
    expect(frames[hiddenFrom]).toBeLessThan(lookAtResult.endMs - 500)
    for (const t of frames.slice(hiddenFrom)) expect(cursorAt(view.cursor, t, true, view.frame)).toBeNull()
  })

  it.each([0.6, 1])('keeps the cursor on the last place it rested to the end (smoothing %s)', (smoothing) => {
    const view = viewWith({ smoothing, hideWhenStill: false })
    const resting = outputFrameTimes(view.map, FPS).filter((t) => t >= lookAtResult.startMs + 700)
    expect(resting.at(-1)).toBeGreaterThan(lookAtResult.endMs - 20)
    for (const t of resting) {
      const at = cursorAt(view.cursor, t, false, view.frame)!
      expect(Math.hypot(at.x - next.x, at.y - next.y)).toBeLessThan(0.01)
    }
  })
})

describe('a taskbar stop right after the last click', () => {
  const finalClick = leftClick(7000, next)
  const stopClick: Click = { t: 9000, ...taskbarButton, button: 'left', up: null }
  const raw = track(
    [...work, ...rest(next, 5800, 7000), ...glide(next, taskbarButton, 7000, 9000), ...rest(taskbarButton, 9000, 9200)],
    [...workClicks.slice(0, 2), finalClick, stopClick],
    9200
  )
  const clean = withoutStopClick(raw, 'window')
  const recording = recordingDocFor(clean, null, stopClickOf(raw, 'window'))

  it('ends the video when the last click’s ring has played', () => {
    expect(recording.trim.end).toBe(finalClick.t + 650)
    expect(takeViewFor(entryOf(clean), recording, null).map.outputMs).toBe(finalClick.t + 650)
  })

  it.each([0, 0.6, 1])('keeps the cursor on the last click from the click to the end of the video (smoothing %s)', (smoothing) => {
    const view = takeViewFor(entryOf(clean), { ...recording, smoothing }, null)
    const landing = outputFrameTimes(view.map, FPS).filter((t) => outputToSource(view.map, t) >= finalClick.t)
    expect(landing.length).toBeGreaterThan(30)
    for (const t of landing) {
      const at = cursorAt(view.cursor, t, false, view.frame)!
      expect(Math.hypot(at.x - next.x, at.y - next.y)).toBeLessThan(0.01)
    }
  })

  const endingAfterLastClick = (afterMs: number) => {
    const cursor = [...rest(next, 0, 1000), ...glide(next, taskbarButton, 1000, 2000)]
    const clicks = [{ t: 1000 - 1, ...next, button: 'left' as const, up: 1050 }]
    const recordingEnding = { ...DEFAULT_RECORDING, smoothing: 0.6, trim: { start: 0, end: 999 + afterMs }, pieces: wholeTake(3000), zooms: null }
    return takeViewFor(entryOf(track(cursor, clicks, 3000)), recordingEnding, null)
  }

  it('holds when the video ends exactly 650 ms after the last click', () => {
    const view = endingAfterLastClick(650)
    const at = cursorAt(view.cursor, 1648, false, view.frame)!
    expect(Math.hypot(at.x - next.x, at.y - next.y)).toBeLessThan(0.01)
  })

  it('lets the cursor leave when the video ends 651 ms after the last click', () => {
    const view = endingAfterLastClick(651)
    const at = cursorAt(view.cursor, 1648, false, view.frame)!
    expect(Math.hypot(at.x - next.x, at.y - next.y)).toBeGreaterThan(50)
  })
})
