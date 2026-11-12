import type { MappedSpan, Rate, TimeMap } from './timemap'
import type { Trim } from './trim'

/** A video that stopped within this many ms of the last kept moment counts as finished, so Play starts over. */
const END_TOLERANCE_MS = 50
const LAST_KEPT_MOMENT_INSET_MS = 1
const MS_PER_SECOND = 1000

export type PlayStep = { kind: 'play'; rate: Rate } | { kind: 'jump'; to: number } | { kind: 'end' }

export const frameMsOf = (fps: number): number => MS_PER_SECOND / fps

const reaches = (span: MappedSpan, frameStart: number, frameMs: number) =>
  span.source.end > frameStart && (span.source.start <= frameStart || span.source.start < frameStart + frameMs)

/**
 * Decides for a presented frame [sourceMs, sourceMs + frameMs): a frame reaching into a kept span plays at
 * that span's rate, so a seek landing on the frame just before a span's start does not jump again. Only a
 * frame wholly inside a cut jumps. With frameMs 0 it decides for the single moment sourceMs.
 */
export function stepAt(sourceMs: number, map: TimeMap, frameMs = 0): PlayStep {
  const { spans } = map
  const reached = spans.find((span) => reaches(span, sourceMs, frameMs))
  if (reached) return { kind: 'play', rate: reached.rate }
  const next = spans.find((span) => span.source.start >= sourceMs + frameMs)
  return next ? { kind: 'jump', to: next.source.start } : { kind: 'end' }
}

export function rateAt(sourceMs: number, map: TimeMap): Rate {
  const step = stepAt(sourceMs, map)
  return step.kind === 'play' ? step.rate : 1
}

/** The middle of the frame holding the last kept moment, so the decoder cannot round onto the first cut frame. */
export function lastKeptFrameTime(map: TimeMap, frameMs: number): number {
  const last = map.spans.at(-1)
  if (!last) return map.trimStart
  const lastMoment = last.source.end - LAST_KEPT_MOMENT_INSET_MS
  const middle = (Math.floor(lastMoment / frameMs) + 0.5) * frameMs
  return Math.max(last.source.start, middle)
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
