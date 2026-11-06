import { clampTrim, TRIM_RULES, type Trim } from '../recording/trim'

const TICK_STEPS_MS = [1000, 2000, 5000, 10_000, 30_000, 60_000]
const MIN_LABEL_GAP_PX = 64

export function timeToX(t: number, duration: number, width: number): number {
  return duration > 0 ? (t / duration) * width : 0
}

export function xToTime(x: number, duration: number, width: number): number {
  if (width <= 0) return 0
  return Math.min(Math.max((x / width) * duration, 0), duration)
}

export function tickStep(duration: number, width: number): number {
  const fits = (step: number) => timeToX(step, duration, width) >= MIN_LABEL_GAP_PX
  return TICK_STEPS_MS.find(fits) ?? TICK_STEPS_MS[TICK_STEPS_MS.length - 1]
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
