import type { Size } from '../render/geometry'
import { LONGEST_CLICK_EFFECT_MS } from './effects'
import { isInFrame, type Click, type CursorSample, type CursorShape, type RecordingTrack } from './track'

export const SMOOTHING_MAX_SIGMA_MS = 120
export const CURSOR_RULES = { stillAfterMs: 1500, showBeforeMoveMs: 150, stillPx: 2, fadeMs: 200, minShapeMs: 100, offFramePx: 32 }

export interface ActiveSpan { start: number; end: number }
export interface CursorPath { t: number[]; x: number[]; y: number[]; shape: (CursorShape | null)[]; activeSpans: ActiveSpan[] }
export interface CursorFrame { x: number; y: number; shape: CursorShape; opacity: number }

const GAUSSIAN_REACH_IN_SIGMAS = 3

interface Point { t: number; x: number; y: number; shape: CursorShape | null }

function lastIndexWhere(length: number, isAtOrBefore: (index: number) => boolean): number {
  let low = 0
  let high = length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (isAtOrBefore(middle)) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}

function lastIndexAtOrBefore(values: number[], target: number): number {
  return lastIndexWhere(values.length, (index) => values[index] <= target)
}

function firstIndexAtOrAfter(values: number[], target: number): number {
  return lastIndexWhere(values.length, (index) => values[index] < target) + 1
}

function withoutShapeFlickers(points: Point[]): Point[] {
  const result = points.map((point) => ({ ...point }))
  let runStart = 0
  while (runStart < result.length) {
    let runEnd = runStart
    while (runEnd + 1 < result.length && result[runEnd + 1].shape === result[runStart].shape) runEnd++
    const isLastRun = runEnd + 1 === result.length
    const isFirstRun = runStart === 0
    if (!isFirstRun && !isLastRun && result[runEnd + 1].t - result[runStart].t < CURSOR_RULES.minShapeMs) {
      const previousShape = result[runStart - 1].shape
      for (let i = runStart; i <= runEnd; i++) result[i].shape = previousShape
    }
    runStart = runEnd + 1
  }
  return result
}

function gaussianSmoothed(points: Point[], sigma: number): Point[] {
  if (sigma === 0) return points
  const times = points.map((point) => point.t)
  const reach = sigma * GAUSSIAN_REACH_IN_SIGMAS
  return points.map((point) => {
    const from = firstIndexAtOrAfter(times, point.t - reach)
    const to = lastIndexAtOrBefore(times, point.t + reach)
    let weightSum = 0
    let x = 0
    let y = 0
    for (let i = from; i <= to; i++) {
      const distance = (times[i] - point.t) / sigma
      const weight = Math.exp(-0.5 * distance * distance)
      weightSum += weight
      x += points[i].x * weight
      y += points[i].y * weight
    }
    return { ...point, x: x / weightSum, y: y / weightSum }
  })
}

function positionAt(times: number[], xs: number[], ys: number[], t: number): { x: number; y: number } {
  const last = times.length - 1
  const index = lastIndexAtOrBefore(times, t)
  if (index < 0) return { x: xs[0], y: ys[0] }
  if (index >= last) return { x: xs[last], y: ys[last] }
  const span = times[index + 1] - times[index]
  const progress = span === 0 ? 0 : (t - times[index]) / span
  return { x: xs[index] + (xs[index + 1] - xs[index]) * progress, y: ys[index] + (ys[index + 1] - ys[index]) * progress }
}

function pinnedToClicks(smoothed: Point[], clicks: Click[], sigma: number): Point[] {
  if (sigma === 0 || clicks.length === 0 || smoothed.length === 0) return smoothed
  const times = smoothed.map((point) => point.t)
  const xs = smoothed.map((point) => point.x)
  const ys = smoothed.map((point) => point.y)

  const withClickPoints = [...smoothed]
  for (const click of clicks) {
    const index = lastIndexAtOrBefore(times, click.t)
    if (index >= 0 && times[index] === click.t) continue
    const shape = smoothed[Math.max(0, index)].shape
    withClickPoints.push({ t: click.t, ...positionAt(times, xs, ys, click.t), shape })
  }
  withClickPoints.sort((a, b) => a.t - b.t)

  const pinTimes = withClickPoints.map((point) => point.t)
  const corrected = withClickPoints.map((point) => ({ ...point }))
  clicks.forEach((click, i) => {
    const gaps = [clicks[i - 1], clicks[i + 1]].filter((other) => other !== undefined).map((other) => Math.abs(other.t - click.t))
    // Narrowed to half the gap to the nearest click so neighbouring corrections never overlap.
    const clickSigma = Math.min(sigma, ...gaps.map((gap) => gap / 2))
    if (clickSigma <= 0) return
    const smoothedAtClick = positionAt(times, xs, ys, click.t)
    const offsetX = click.x - smoothedAtClick.x
    const offsetY = click.y - smoothedAtClick.y
    const radius = 2 * clickSigma
    const from = firstIndexAtOrAfter(pinTimes, click.t - radius)
    const to = lastIndexAtOrBefore(pinTimes, click.t + radius)
    for (let k = from; k <= to; k++) {
      const u = Math.abs(pinTimes[k] - click.t) / radius
      const weight = (1 - u * u) ** 2
      corrected[k].x += offsetX * weight
      corrected[k].y += offsetY * weight
    }
  })
  return corrected
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

function activeSpansOf(points: Point[], clicks: Click[]): ActiveSpan[] {
  if (points.length === 0) return []
  const spanAround = (from: number, to: number): ActiveSpan => ({
    start: from - CURSOR_RULES.showBeforeMoveMs,
    end: to + CURSOR_RULES.stillAfterMs
  })
  const spans = [spanAround(points[0].t, points[0].t), ...clicks.map((click) => spanAround(click.t, click.t))]
  let anchor = points[0]
  for (let i = 1; i < points.length; i++) {
    if (Math.hypot(points[i].x - anchor.x, points[i].y - anchor.y) <= CURSOR_RULES.stillPx) continue
    spans.push(spanAround(points[i - 1].t, points[i].t))
    anchor = points[i]
  }
  return mergedSpans(spans)
}

function heldOnLandingClick(cursor: CursorSample[], track: RecordingTrack, endMs: number): CursorSample[] {
  const frame = { width: track.width, height: track.height }
  const landingClick = track.clicks.findLast((click) => click.t <= endMs && isInFrame(click, frame))
  if (!landingClick || endMs - landingClick.t > LONGEST_CLICK_EFFECT_MS) return cursor
  return cursor.map((sample) => (sample.t > landingClick.t ? { ...sample, x: landingClick.x, y: landingClick.y } : sample))
}

/** Smoothing is 0..1. The smoothed path is pinned to every click so effects land exactly where the click happened. When the video ends while the last click's effect still plays, the cursor holds on that click. */
export function buildCursorPath(track: RecordingTrack, smoothing: number, endMs = track.durationMs): CursorPath {
  const sigma = Math.max(0, Math.min(1, smoothing)) * SMOOTHING_MAX_SIGMA_MS
  const steady = withoutShapeFlickers(heldOnLandingClick(track.cursor, track, endMs))
  const pinned = pinnedToClicks(gaussianSmoothed(steady, sigma), track.clicks, sigma)
  return {
    t: pinned.map((point) => point.t),
    x: pinned.map((point) => point.x),
    y: pinned.map((point) => point.y),
    shape: pinned.map((point) => point.shape),
    activeSpans: activeSpansOf(pinned, track.clicks)
  }
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
  const index = lastIndexWhere(spans.length, (i) => spans[i].start - CURSOR_RULES.fadeMs <= t)
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
