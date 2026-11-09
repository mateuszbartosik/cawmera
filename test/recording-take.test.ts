import { describe, expect, it } from 'vitest'
import { cameraAt } from '../src/renderer/src/recording/camera'
import { buildCursorPath, cursorAt } from '../src/renderer/src/recording/cursor'
import { activeClicks } from '../src/renderer/src/recording/effects'
import { frameTimes } from '../src/renderer/src/recording/export'
import { isShownClick, stopClickOf, withoutStopClick, type Click, type CursorSample, type RecordingTrack } from '../src/renderer/src/recording/track'
import { autoTrim } from '../src/renderer/src/recording/trim'
import { autoZooms } from '../src/renderer/src/recording/zooms'

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

const work = [
  ...glide({ x: 300, y: 200 }, search, 0, 1200),
  ...glide(search, filter, 1200, 2400),
  ...glide(filter, next, 2400, 5800)
]
const workClicks = [leftClick(1200, search), leftClick(2400, filter), leftClick(6000, next)]
const lookAtResult = { startMs: 5800, endMs: 8400 }

const track = (cursor: CursorSample[], clicks: Click[], durationMs: number): RecordingTrack =>
  ({ kind: 'monitor', ...frame, fps: FPS, durationMs, scale: 1, cursor, clicks })

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
  const trim = autoTrim(clean, stopClickOf(raw, stoppedBy))
  const exportedFrames = frameTimes(trim, FPS)

  it('ends the video when the look at the result ends', () => {
    expect(trim).toEqual({ start: 0, end: lookAtResult.endMs })
  })

  it('shows no click on the taskbar or its thumbnail', () => {
    const atTaskbar = (spot: Spot) => spot.y >= thumbnail.y
    expect(clean.clicks.some(atTaskbar)).toBe(false)
    for (const t of exportedFrames) expect(activeClicks(clean.clicks, t, 'ring', frame).some(atTaskbar)).toBe(false)
  })

  it('marks the clicks with rings and zooms on the Clip row, and no others', () => {
    expect(clean.clicks.filter((click) => isShownClick(click, frame)).map((click) => click.t)).toEqual(workClicks.map((click) => click.t))
  })

  it.each(['calm', 'quick'] as const)('zooms on the real clicks only and is wide for the first and last second (%s)', (speed) => {
    const zooms = autoZooms(clean.clicks, frame, trim, speed)
    expect(zooms.map(({ depth, focus }) => ({ depth, focus }))).toEqual([
      { depth: 2.5, focus: { x: 500, y: 310 } },
      { depth: 2.5, focus: next }
    ])
    const edgeFrames = exportedFrames.filter((t) => t <= trim.start + 1000 || t >= trim.end - 1000)
    for (const t of edgeFrames) expect(cameraAt(t, zooms, frame, speed)).toEqual(wide)
    expect(cameraAt(exportedFrames.at(-1)!, zooms, frame, speed)).toEqual(wide)
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
  const trim = autoTrim(clean, stopClickOf(raw, 'window'))

  it('ends the video when the last click’s ring has played', () => {
    expect(trim.end).toBe(finalClick.t + 650)
  })

  it.each([0, 0.6, 1])('keeps the cursor on the last click from the click to the end of the video (smoothing %s)', (smoothing) => {
    const path = buildCursorPath(clean, smoothing, trim.end)
    const landing = frameTimes(trim, FPS).filter((t) => t >= finalClick.t)
    expect(landing.length).toBeGreaterThan(30)
    for (const t of landing) {
      const at = cursorAt(path, t, false, frame)!
      expect(Math.hypot(at.x - next.x, at.y - next.y)).toBeLessThan(0.01)
    }
  })

  const endingAfterLastClick = (afterMs: number) => {
    const cursor = [...rest(next, 0, 1000), ...glide(next, taskbarButton, 1000, 2000)]
    const clicks = [{ t: 1000 - 1, ...next, button: 'left' as const, up: 1050 }]
    return buildCursorPath(track(cursor, clicks, 3000), 0.6, 999 + afterMs)
  }

  it('holds when the video ends exactly 650 ms after the last click', () => {
    const at = cursorAt(endingAfterLastClick(650), 1648, false, frame)!
    expect(Math.hypot(at.x - next.x, at.y - next.y)).toBeLessThan(0.01)
  })

  it('lets the cursor leave when the video ends 651 ms after the last click', () => {
    const at = cursorAt(endingAfterLastClick(651), 1648, false, frame)!
    expect(Math.hypot(at.x - next.x, at.y - next.y)).toBeGreaterThan(50)
  })
})
