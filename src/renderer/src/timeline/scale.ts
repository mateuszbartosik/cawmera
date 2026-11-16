import { outputFloor } from '../recording/pieces'
import { timeMapOf, type Piece, type Span } from '../recording/timemap'
import { clampTrim, TRIM_RULES, type Trim } from '../recording/trim'

const TICK_STEPS_MS = [1000, 2000, 5000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000]
const MIN_LABEL_GAP_PX = 64

/** The stretch of the take the rows show, in source ms. */
export interface TimelineView { start: number; end: number }

export const MIN_VIEW_MS = 2000
export const VIEW_ZOOM_STEP = 1.5

export const wholeView = (durationMs: number): TimelineView => ({ start: 0, end: durationMs })

const lengthOf = (view: TimelineView) => view.end - view.start

export function timeToX(t: number, view: TimelineView, width: number): number {
  const length = lengthOf(view)
  return length > 0 ? ((t - view.start) / length) * width : 0
}

export function xToTime(x: number, view: TimelineView, width: number): number {
  if (width <= 0) return view.start
  return Math.min(Math.max(view.start + (x / width) * lengthOf(view), view.start), view.end)
}

export function tickStep(view: TimelineView, width: number): number {
  const fits = (step: number) => timeToX(view.start + step, view, width) >= MIN_LABEL_GAP_PX
  return TICK_STEPS_MS.find(fits) ?? TICK_STEPS_MS[TICK_STEPS_MS.length - 1]
}

const viewAt = (start: number, length: number, durationMs: number): TimelineView => {
  const clampedStart = Math.min(Math.max(start, 0), Math.max(durationMs - length, 0))
  return { start: clampedStart, end: clampedStart + length }
}

/** Factors above 1 zoom in. The time under `anchorMs` stays at the same place in the window. */
export function zoomView(view: TimelineView, factor: number, anchorMs: number, durationMs: number): TimelineView {
  const length = lengthOf(view)
  const nextLength = Math.min(Math.max(length / factor, Math.min(MIN_VIEW_MS, durationMs)), durationMs)
  const anchorShare = length > 0 ? (anchorMs - view.start) / length : 0.5
  return viewAt(anchorMs - anchorShare * nextLength, nextLength, durationMs)
}

export function scrollView(view: TimelineView, deltaMs: number, durationMs: number): TimelineView {
  return viewAt(view.start + deltaMs, lengthOf(view), durationMs)
}

/** The time kept inside the view, so rounding never leaves the playhead a hair past its edge. */
const keptIn = (view: TimelineView, time: number) => ({ time: Math.min(Math.max(time, view.start), view.end), view })

/**
 * Where a drag on the ruler or the playhead that began in view `from` puts the playhead, and the view that keeps it in sight.
 * Inside the view the time is the one under the pointer; past an edge it runs on at the same scale, and the view scrolls so the
 * playhead stays at that edge. The time stays inside the trim, so the view never scrolls past it.
 */
export function playheadDrag(x: number, from: TimelineView, width: number, trim: Trim, durationMs: number): { time: number; view: TimelineView } {
  const length = lengthOf(from)
  const pointed = width > 0 ? from.start + (x / width) * length : from.start
  const time = Math.min(Math.max(pointed, trim.start), trim.end)
  if (time > from.end) return keptIn(viewAt(time - length, length, durationMs), time)
  if (time < from.start) return keptIn(viewAt(time, length, durationMs), time)
  return { time, view: from }
}

/** The window as stored: the whole take when none was set, and always inside the take. */
export function fitView(view: TimelineView | null, durationMs: number): TimelineView {
  return view ? viewAt(view.start, Math.min(lengthOf(view), durationMs), durationMs) : wholeView(durationMs)
}

function withEdge(trim: Trim, edge: 'start' | 'end', t: number): Trim {
  return edge === 'start' ? { start: t, end: trim.end } : { start: trim.start, end: t }
}

export function dragTrim(trim: Trim, edge: 'start' | 'end', t: number, duration: number, pieces: Piece[]): Trim {
  const minLength = Math.min(TRIM_RULES.minLengthMs, duration)
  const wanted = edge === 'start' ? Math.min(t, trim.end - minLength) : Math.max(t, trim.start + minLength)
  const dragged = clampTrim(withEdge(trim, edge, wanted), duration)
  const floor = outputFloor(trim, pieces)
  const playsLongEnough = (edgeAt: number) => timeMapOf(withEdge(trim, edge, edgeAt), pieces).outputMs >= floor
  if (playsLongEnough(dragged[edge])) return dragged
  let kept = Math.round(trim[edge])
  let refused = Math.round(dragged[edge])
  while (Math.abs(refused - kept) > 1) {
    const middle = Math.trunc((kept + refused) / 2)
    if (playsLongEnough(middle)) kept = middle
    else refused = middle
  }
  return withEdge(trim, edge, kept)
}

const clampBetween = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high))

/** The span with its start at `start`, keeping its length and staying inside `bounds`. */
export function moveSpan(span: Span, start: number, bounds: Span): Span {
  const length = span.end - span.start
  const movedStart = clampBetween(start, bounds.start, bounds.end - length)
  return { start: movedStart, end: movedStart + length }
}

/** The span with one edge at `at`, inside `bounds` and at least `minMs` long. */
export function stretchSpan(span: Span, edge: 'start' | 'end', at: number, bounds: Span, minMs: number): Span {
  if (edge === 'start') return { start: clampBetween(at, bounds.start, span.end - minMs), end: span.end }
  return { start: span.start, end: Math.min(Math.max(at, span.start + minMs), Math.max(bounds.end, span.start)) }
}

export function formatClock(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100)
  const seconds = Math.floor(tenths / 10)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}.${tenths % 10}`
}

export function formatRulerLabel(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
