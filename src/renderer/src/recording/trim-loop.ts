import type { Rate, TimeMap } from './timemap'
import type { Trim } from './trim'

/** A video that stopped within this many ms of the last kept moment counts as finished, so Play starts over. */
const END_TOLERANCE_MS = 50

export type PlayStep = { kind: 'play'; rate: Rate } | { kind: 'jump'; to: number } | { kind: 'end' }

export function stepAt(sourceMs: number, map: TimeMap): PlayStep {
  const { spans } = map
  const inside = spans.find((span) => sourceMs >= span.source.start && sourceMs < span.source.end)
  if (inside) return { kind: 'play', rate: inside.rate }
  const next = spans.find((span) => span.source.start > sourceMs)
  return next ? { kind: 'jump', to: next.source.start } : { kind: 'end' }
}

export function rateAt(sourceMs: number, map: TimeMap): Rate {
  const step = stepAt(sourceMs, map)
  return step.kind === 'play' ? step.rate : 1
}

export function playbackStart(sourceMs: number, map: TimeMap, finished: boolean): number {
  const first = map.spans[0]?.source.start ?? map.trimStart
  const lastEnd = map.spans.at(-1)?.source.end ?? map.trimStart
  if (finished || sourceMs >= lastEnd - END_TOLERANCE_MS) return first
  const step = stepAt(sourceMs, map)
  return step.kind === 'jump' ? step.to : step.kind === 'end' ? first : sourceMs
}

export function clampToTrim(time: number, trim: Trim): number {
  return Math.min(Math.max(time, trim.start), trim.end)
}
