import { clamp, type Point, type Size } from '../render/geometry'
import { firstIndexWhere } from './binary-search'
import { LONGEST_CLICK_EFFECT_MS } from './effects'
import { springStep, type Spring } from './spring'
import { isInFrame, type Click, type CursorSample, type CursorShape, type RecordingTrack } from './track'

/** 100% smooths about as much as stage 1's Gaussian at σ = 120 ms: there and back, the spring spreads a sample over a standard deviation of 2τ. */
export const SMOOTHING_MAX_TAU_MS = 60
export const MIN_PIN_MS = 17
/** The cursor leans by up to `maxDeg`, reached at a horizontal speed of `fullAtPxPerMs` logical px per ms. */
export const TILT = { maxDeg: 10, fullAtPxPerMs: 2.5 }
export const CURSOR_RULES = { stillAfterMs: 1500, showBeforeMoveMs: 150, stillPx: 2, fadeMs: 200, minShapeMs: 100, offFramePx: 32 }

/** `notBefore` is the seam of the cut, if any, that the span's movement or click follows: the cursor appears with the cut, not before it. */
export interface ActiveSpan { start: number; end: number; notBefore: number }
/** Velocities are in px per ms. Two points at one time are a cut's seam, where the cursor jumps. */
export interface CursorPath { t: number[]; x: number[]; y: number[]; vx: number[]; vy: number[]; shape: (CursorShape | null)[]; activeSpans: ActiveSpan[] }
export interface CursorFrame { x: number; y: number; shape: CursorShape; opacity: number }

/** Parallel arrays rather than an object per sample: a ten-minute take has 72,000 samples. */
type Samples = Pick<CursorPath, 't' | 'x' | 'y' | 'shape'>
interface IndexRange { from: number; to: number }

const CRITICALLY_DAMPED = 1
const RUN_END_PAD_IN_TAUS = 10

function lastIndexAtOrBefore(values: number[], target: number): number {
  return firstIndexWhere(values.length, (index) => values[index] > target) - 1
}

function firstIndexAtOrAfter(values: number[], target: number): number {
  return firstIndexWhere(values.length, (index) => values[index] >= target)
}

function startsAfterSeam(times: number[], index: number): boolean {
  return index > 0 && times[index] === times[index - 1]
}

function withoutShapeFlickers(times: number[], shapes: (CursorShape | null)[]): (CursorShape | null)[] {
  const result = [...shapes]
  let runStart = 0
  while (runStart < result.length) {
    let runEnd = runStart
    while (runEnd + 1 < result.length && result[runEnd + 1] === result[runStart]) runEnd++
    const isLastRun = runEnd + 1 === result.length
    const isFirstRun = runStart === 0
    if (!isFirstRun && !isLastRun && times[runEnd + 1] - times[runStart] < CURSOR_RULES.minShapeMs) {
      const previousShape = result[runStart - 1]
      for (let i = runStart; i <= runEnd; i++) result[i] = previousShape
    }
    runStart = runEnd + 1
  }
  return result
}

function samplesOf(cursor: CursorSample[]): Samples {
  const t = cursor.map((sample) => sample.t)
  return {
    t,
    x: cursor.map((sample) => sample.x),
    y: cursor.map((sample) => sample.y),
    shape: withoutShapeFlickers(t, cursor.map((sample) => sample.shape))
  }
}

function runsBetweenSeams(times: number[]): IndexRange[] {
  const runs = [{ from: 0, to: times.length }]
  for (let i = 1; i < times.length; i++) {
    if (!startsAfterSeam(times, i)) continue
    runs[runs.length - 1].to = i
    runs.push({ from: i, to: times.length })
  }
  return runs
}

/**
 * Exact for a goal moving steadily from `from` to `to`, as the path does between two samples: the follower trails a steady
 * goal by 2ζ/ω, and its offset from that trail settles as the spring does.
 */
function stepAlong(value: number, velocity: number, from: number, to: number, spring: Spring, dtMs: number): [number, number] {
  const rate = (to - from) / dtMs
  const trail = (2 * spring.damping * rate) / spring.omega
  const [offset, offsetVelocity] = springStep(value - (from - trail), velocity - rate, 0, spring, dtMs)
  return [to - trail + offset, rate + offsetVelocity]
}

/** In place: a follower at rest on the first value moves along the path to the last, then follows that back, which cancels its lag. */
function followThereAndBack(times: number[], values: number[], spring: Spring): void {
  let previousGoal = values[0]
  let state: [number, number] = [previousGoal, 0]
  for (let i = 1; i < values.length; i++) {
    const goal = values[i]
    state = stepAlong(state[0], state[1], previousGoal, goal, spring, times[i] - times[i - 1])
    values[i] = state[0]
    previousGoal = goal
  }
  previousGoal = values[values.length - 1]
  state = [previousGoal, 0]
  for (let i = values.length - 2; i >= 0; i--) {
    const goal = values[i]
    state = stepAlong(state[0], state[1], previousGoal, goal, spring, times[i + 1] - times[i])
    values[i] = state[0]
    previousGoal = goal
  }
}

/** The run's samples within `padMs` of each end, nearest the end last, so their reflections run on in time order. */
function mirroredNearEnds(times: number[], { from, to }: IndexRange, padMs: number): { start: number[]; end: number[] } {
  const start: number[] = []
  for (let k = from + 1; k < to && times[k] - times[from] <= padMs; k++) start.push(k)
  const end: number[] = []
  for (let k = to - 2; k >= from && times[to - 1] - times[k] <= padMs; k--) end.push(k)
  return { start: start.reverse(), end }
}

/**
 * Each end of the run carries on as its last stretch of motion turned through the end sample (filtfilt's odd reflection),
 * so the passes start at rest beyond the run and the cursor reaches a cut or the video's end at full speed on its path.
 */
function smoothedRun(samples: Samples, run: IndexRange, spring: Spring, padMs: number): Pick<Samples, 'x' | 'y'> {
  const mirrored = mirroredNearEnds(samples.t, run, padMs)
  const padded = (series: number[]) => mirrored.start.map((k) => 2 * series[run.from] - series[k])
    .concat(series.slice(run.from, run.to), mirrored.end.map((k) => 2 * series[run.to - 1] - series[k]))
  const unpadded = (values: number[]) => values.slice(mirrored.start.length, mirrored.start.length + run.to - run.from)
  const times = padded(samples.t)
  const x = padded(samples.x)
  const y = padded(samples.y)
  followThereAndBack(times, x, spring)
  followThereAndBack(times, y, spring)
  return { x: unpadded(x), y: unpadded(y) }
}

function springSmoothed(samples: Samples, tau: number): Samples {
  if (tau === 0 || samples.t.length === 0) return samples
  const spring: Spring = { omega: 1 / tau, damping: CRITICALLY_DAMPED }
  const runs = runsBetweenSeams(samples.t).map((run) => smoothedRun(samples, run, spring, RUN_END_PAD_IN_TAUS * tau))
  return { ...samples, x: runs.flatMap((run) => run.x), y: runs.flatMap((run) => run.y) }
}

function valueAt(times: number[], values: number[], t: number): number {
  const last = times.length - 1
  const index = lastIndexAtOrBefore(times, t)
  if (index < 0) return values[0]
  if (index >= last) return values[last]
  const span = times[index + 1] - times[index]
  const progress = span === 0 ? 0 : (t - times[index]) / span
  return values[index] + (values[index + 1] - values[index]) * progress
}

function positionAt(times: number[], xs: number[], ys: number[], t: number): Point {
  return { x: valueAt(times, xs, t), y: valueAt(times, ys, t) }
}

/** New arrays with a point on the path at each of the ascending `times` that has none. */
function withPointsAt(samples: Samples, times: number[]): Samples {
  const result: Samples = { t: [], x: [], y: [], shape: [] }
  const add = (t: number, x: number, y: number, shape: CursorShape | null) => {
    result.t.push(t)
    result.x.push(x)
    result.y.push(y)
    result.shape.push(shape)
  }
  let next = 0
  const addSamplesUntil = (end: number) => {
    for (; next < samples.t.length && samples.t[next] <= end; next++) add(samples.t[next], samples.x[next], samples.y[next], samples.shape[next])
  }
  for (const t of times) {
    addSamplesUntil(t)
    if (result.t.at(-1) === t) continue
    const shape = result.t.length > 0 ? result.shape[result.shape.length - 1] : (samples.shape[0] ?? null)
    add(t, valueAt(samples.t, samples.x, t), valueAt(samples.t, samples.y, t), shape)
  }
  addSamplesUntil(Number.POSITIVE_INFINITY)
  return result
}

/** One pin per click time: buttons pressed together are one place. */
function pinnedToClicks(samples: Samples, clicks: Click[], tau: number): Samples {
  if (clicks.length === 0 || samples.t.length === 0) return samples
  const pins = clicks.filter((click, i) => click.t !== clicks[i - 1]?.t)
  const pinned = withPointsAt(samples, pins.map((click) => click.t))
  const runs = runsBetweenSeams(pinned.t)
  pins.forEach((click, i) => {
    const halfGaps = [pins[i - 1], pins[i + 1]].filter((other) => other !== undefined).map((other) => Math.abs(other.t - click.t) / 2)
    // Narrowed to half the gap to the nearest click, below MIN_PIN_MS too, so neighbouring corrections never overlap.
    const pinMs = Math.min(...halfGaps, Math.max(MIN_PIN_MS, 2 * tau))
    const offsetX = click.x - valueAt(samples.t, samples.x, click.t)
    const offsetY = click.y - valueAt(samples.t, samples.y, click.t)
    const radius = 2 * pinMs
    const at = lastIndexAtOrBefore(pinned.t, click.t)
    const run = runs[firstIndexWhere(runs.length, (r) => runs[r].from > at) - 1]
    const from = Math.max(run.from, firstIndexAtOrAfter(pinned.t, click.t - radius))
    const to = Math.min(run.to, lastIndexAtOrBefore(pinned.t, click.t + radius) + 1)
    for (let k = from; k < to; k++) {
      const u = Math.abs(pinned.t[k] - click.t) / radius
      const weight = (1 - u * u) ** 2
      pinned.x[k] += offsetX * weight
      pinned.y[k] += offsetY * weight
    }
  })
  return pinned
}

function velocitiesOf(times: number[], values: number[]): number[] {
  return values.map((_, i) => {
    const before = startsAfterSeam(times, i) ? i : Math.max(0, i - 1)
    const after = i + 1 < values.length && !startsAfterSeam(times, i + 1) ? i + 1 : i
    return after === before ? 0 : (values[after] - values[before]) / (times[after] - times[before])
  })
}

function mergedSpans(spans: ActiveSpan[]): ActiveSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const merged: ActiveSpan[] = []
  for (const span of sorted) {
    const previous = merged[merged.length - 1]
    if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end)
    else merged.push({ ...span })
  }
  return merged
}

function activeSpansOf({ t, x, y }: Samples, clicks: Click[]): ActiveSpan[] {
  if (t.length === 0) return []
  const seams = t.filter((_, i) => startsAfterSeam(t, i))
  const spanAround = (from: number, to: number): ActiveSpan => ({
    start: from - CURSOR_RULES.showBeforeMoveMs,
    end: to + CURSOR_RULES.stillAfterMs,
    notBefore: seams[lastIndexAtOrBefore(seams, from)] ?? Number.NEGATIVE_INFINITY
  })
  const spans = [spanAround(t[0], t[0]), ...clicks.map((click) => spanAround(click.t, click.t))]
  let anchor = 0
  for (let i = 1; i < t.length; i++) {
    if (startsAfterSeam(t, i)) {
      anchor = i
      continue
    }
    if (Math.hypot(x[i] - x[anchor], y[i] - y[anchor]) <= CURSOR_RULES.stillPx) continue
    spans.push(spanAround(t[i - 1], t[i]))
    anchor = i
  }
  return mergedSpans(spans)
}

function landingClickOf(track: RecordingTrack, endMs: number): Click | null {
  const frame = { width: track.width, height: track.height }
  const lastClick = track.clicks.findLast((click) => click.t <= endMs && isInFrame(click, frame))
  return lastClick && endMs - lastClick.t <= LONGEST_CLICK_EFFECT_MS ? lastClick : null
}

function heldOnLandingClick(samples: Samples, landingClick: Click | null): Samples {
  if (!landingClick) return samples
  const after = lastIndexAtOrBefore(samples.t, landingClick.t) + 1
  return { ...samples, x: [...samples.x].fill(landingClick.x, after), y: [...samples.y].fill(landingClick.y, after) }
}

function exactlyOnLandingClick(samples: Samples, landingClick: Click | null): Samples {
  if (!landingClick) return samples
  const held = withPointsAt(samples, [landingClick.t])
  const landed = firstIndexAtOrAfter(held.t, landingClick.t)
  held.x.fill(landingClick.x, landed)
  held.y.fill(landingClick.y, landed)
  return held
}

/**
 * Smoothing is 0..1, a spring run forward and then back, so the cursor glides without lagging, into a cut or the video's end
 * too. At every smoothing the path is pinned to every click up to the end so effects land exactly where the click happened.
 * When the video ends while the last click's effect still plays, the cursor holds on that click. A cut's seam splits the
 * path: the cursor jumps with the cut, and the jump isn't movement.
 */
export function buildCursorPath(track: RecordingTrack, smoothing: number, endMs = track.durationMs): CursorPath {
  const tau = clamp01(smoothing) * SMOOTHING_MAX_TAU_MS
  const landingClick = landingClickOf(track, endMs)
  const clicks = track.clicks.filter((click) => click.t <= endMs)
  const steady = heldOnLandingClick(samplesOf(track.cursor), landingClick)
  const path = exactlyOnLandingClick(pinnedToClicks(springSmoothed(steady, tau), clicks, tau), landingClick)
  return { ...path, vx: velocitiesOf(path.t, path.x), vy: velocitiesOf(path.t, path.y), activeSpans: activeSpansOf(path, clicks) }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function opacityWithin(span: ActiveSpan, t: number): number {
  if (t < span.notBefore) return 0
  const fadeIn = clamp01((t - (span.start - CURSOR_RULES.fadeMs)) / CURSOR_RULES.fadeMs)
  const fadeOut = clamp01((span.end + CURSOR_RULES.fadeMs - t) / CURSOR_RULES.fadeMs)
  return Math.min(fadeIn, fadeOut)
}

function opacityAt(spans: ActiveSpan[], t: number): number {
  const index = firstIndexWhere(spans.length, (i) => spans[i].start - CURSOR_RULES.fadeMs > t) - 1
  const candidates = [spans[index], spans[index - 1]].filter((span) => span !== undefined)
  return Math.max(0, ...candidates.map((span) => opacityWithin(span, t)))
}

function isFarOutside(x: number, y: number, frame: Size): boolean {
  const margin = CURSOR_RULES.offFramePx
  return x < -margin || y < -margin || x > frame.width + margin || y > frame.height + margin
}

/** Where the path has the cursor, whether it shows there or not. */
export function cursorPositionAt(path: CursorPath, t: number): Point {
  return positionAt(path.t, path.x, path.y, t)
}

export function cursorAt(path: CursorPath, t: number, hideWhenStill: boolean, frame: Size): CursorFrame | null {
  if (path.t.length === 0) return null
  const shape = path.shape[Math.max(0, lastIndexAtOrBefore(path.t, t))]
  if (shape === null) return null
  const { x, y } = positionAt(path.t, path.x, path.y, t)
  if (isFarOutside(x, y, frame)) return null
  const opacity = hideWhenStill ? opacityAt(path.activeSpans, t) : 1
  if (opacity === 0) return null
  return { x, y, shape, opacity }
}

/** Radians, clockwise positive: the cursor leans with its horizontal speed, like a pointer dragged by its tip. */
export function tiltAt(path: CursorPath, t: number, scale: number): number {
  if (path.t.length === 0) return 0
  const lean = clamp(valueAt(path.t, path.vx, t) / scale / TILT.fullAtPxPerMs, -1, 1)
  return (lean * TILT.maxDeg * Math.PI) / 180
}
