import { clampTrim, TRIM_RULES, type Trim } from '../recording/trim'

const TICK_STEPS_MS = [1000, 2000, 5000, 10_000, 30_000, 60_000]
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

/** The window as stored: the whole take when none was set, and always inside the take. */
export function fitView(view: TimelineView | null, durationMs: number): TimelineView {
  return view ? viewAt(view.start, Math.min(lengthOf(view), durationMs), durationMs) : wholeView(durationMs)
}

export function dragTrim(trim: Trim, edge: 'start' | 'end', t: number, duration: number): Trim {
  const minLength = Math.min(TRIM_RULES.minLengthMs, duration)
  if (edge === 'start') return clampTrim({ start: Math.min(t, trim.end - minLength), end: trim.end }, duration)
  return clampTrim({ start: trim.start, end: Math.max(t, trim.start + minLength) }, duration)
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
