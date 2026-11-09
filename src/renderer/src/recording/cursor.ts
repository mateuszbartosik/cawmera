import { clamp, type Size } from '../render/geometry'
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

export interface ActiveSpan { start: number; end: number }
/** Velocities are in px per ms. Two points at one time are a cut's seam, where the cursor jumps. */
export interface CursorPath { t: number[]; x: number[]; y: number[]; vx: number[]; vy: number[]; shape: (CursorShape | null)[]; activeSpans: ActiveSpan[] }
export interface CursorFrame { x: number; y: number; shape: CursorShape; opacity: number }

/** Parallel arrays rather than an object per sample: a ten-minute take has 72,000 samples. */
type Samples = Pick<CursorPath, 't' | 'x' | 'y' | 'shape'>
interface IndexRange { from: number; to: number }

const CRITICALLY_DAMPED = 1

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

/** In place: a follower at rest on the first value steps towards each next one, then follows that back from the last, which cancels its lag. */
function followedThereAndBack(times: number[], values: number[], { from, to }: IndexRange, spring: Spring): void {
  let state: [number, number] = [values[from], 0]
  for (let i = from + 1; i < to; i++) {
    state = springStep(state[0], state[1], values[i], spring, times[i] - times[i - 1])
    values[i] = state[0]
  }
  state = [values[to - 1], 0]
  for (let i = to - 2; i >= from; i--) {
    state = springStep(state[0], state[1], values[i], spring, times[i + 1] - times[i])
    values[i] = state[0]
  }
}

function springSmoothed(samples: Samples, tau: number): Samples {
  if (tau === 0 || samples.t.length === 0) return samples
  const spring: Spring = { omega: 1 / tau, damping: CRITICALLY_DAMPED }
  const x = [...samples.x]
  const y = [...samples.y]
  for (const run of runsBetweenSeams(samples.t)) {
    followedThereAndBack(samples.t, x, run, spring)
    followedThereAndBack(samples.t, y, run, spring)
  }
  return { ...samples, x, y }
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

function positionAt(times: number[], xs: number[], ys: number[], t: number): { x: number; y: number } {
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

function pinnedToClicks(samples: Samples, clicks: Click[], tau: number): Samples {
  if (clicks.length === 0 || samples.t.length === 0) return samples
  const pinned = withPointsAt(samples, clicks.map((click) => click.t))
  clicks.forEach((click, i) => {
    const halfGaps = [clicks[i - 1], clicks[i + 1]].filter((other) => other !== undefined).map((other) => Math.abs(other.t - click.t) / 2)
    // Narrowed to half the gap to the nearest click, below MIN_PIN_MS too, so neighbouring corrections never overlap.
    const pinMs = Math.min(...halfGaps, Math.max(MIN_PIN_MS, 2 * tau))
    if (pinMs <= 0) return
    const offsetX = click.x - valueAt(samples.t, samples.x, click.t)
    const offsetY = click.y - valueAt(samples.t, samples.y, click.t)
    const radius = 2 * pinMs
    const pull = (k: number) => {
      const u = Math.abs(pinned.t[k] - click.t) / radius
      const weight = (1 - u * u) ** 2
      pinned.x[k] += offsetX * weight
      pinned.y[k] += offsetY * weight
    }
    const at = lastIndexAtOrBefore(pinned.t, click.t)
    for (let k = at; k >= 0 && click.t - pinned.t[k] < radius; k--) {
      pull(k)
      if (startsAfterSeam(pinned.t, k)) break
    }
    for (let k = at + 1; k < pinned.t.length && pinned.t[k] - click.t < radius && !startsAfterSeam(pinned.t, k); k++) pull(k)
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
  const spanAround = (from: number, to: number): ActiveSpan => ({
    start: from - CURSOR_RULES.showBeforeMoveMs,
    end: to + CURSOR_RULES.stillAfterMs
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
 * Smoothing is 0..1, a spring run forward and then back, so the cursor glides without lagging. At every smoothing the path is
 * pinned to every click up to the end so effects land exactly where the click happened. When the video ends while the last
 * click's effect still plays, the cursor holds on that click. A cut's seam splits the path: the cursor jumps with the cut, and
 * the jump isn't movement.
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
