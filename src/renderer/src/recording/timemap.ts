import type { Rect } from '../render/geometry'
import { firstIndexWhere } from './binary-search'
import type { Click, CursorSample, RecordingTrack } from './track'
import type { Trim } from './trim'

export type Rate = 1 | 2 | 4 | 8
export interface Span { start: number; end: number }
export interface Piece extends Span { rate: Rate; cut: boolean }
export interface MappedSpan { source: Span; outputStart: number; rate: Rate }
export interface TimeMap { spans: MappedSpan[]; outputMs: number; trimStart: number }

export const RATES: readonly Rate[] = [1, 2, 4, 8]

const MS_PER_SECOND = 1000
const FRAME_COUNT_TOLERANCE = 1e-9

export const wholeTake = (durationMs: number): Piece[] => [{ start: 0, end: durationMs, rate: 1, cut: false }]

export function timeMapOf(trim: Trim, pieces: Piece[]): TimeMap {
  const spans: MappedSpan[] = []
  let outputMs = 0
  for (const piece of pieces) {
    if (piece.cut) continue
    const start = Math.max(piece.start, trim.start)
    const end = Math.min(piece.end, trim.end)
    if (end <= start) continue
    spans.push({ source: { start, end }, outputStart: outputMs, rate: piece.rate })
    outputMs += (end - start) / piece.rate
  }
  return { spans, outputMs, trimStart: trim.start }
}

const firstSpanEndingAfter = (spans: MappedSpan[], sourceMs: number) => spans[firstIndexWhere(spans.length, (i) => spans[i].source.end > sourceMs)]

const outputIn = (span: MappedSpan, sourceMs: number) => span.outputStart + (sourceMs - span.source.start) / span.rate

export function sourceToOutput(map: TimeMap, sourceMs: number): number | null {
  const { spans } = map
  if (spans.length === 0) return null
  if (sourceMs === spans[spans.length - 1].source.end) return map.outputMs
  const span = firstSpanEndingAfter(spans, sourceMs)
  if (!span || sourceMs < span.source.start) return null
  return outputIn(span, sourceMs)
}

export function snapToOutput(map: TimeMap, sourceMs: number): number {
  const span = firstSpanEndingAfter(map.spans, sourceMs)
  if (!span) return map.outputMs
  return sourceMs < span.source.start ? span.outputStart : outputIn(span, sourceMs)
}

/** Like snapToOutput, except that time before the first span runs on below output 0 at that span's rate. */
export function preRollToOutput(map: TimeMap, sourceMs: number): number {
  const first = map.spans[0]
  return first && sourceMs < first.source.start ? outputIn(first, sourceMs) : snapToOutput(map, sourceMs)
}

export function outputToSource(map: TimeMap, outputMs: number): number {
  const { spans } = map
  if (spans.length === 0) return map.trimStart
  const clamped = Math.min(Math.max(outputMs, 0), map.outputMs)
  const index = Math.max(0, firstIndexWhere(spans.length, (i) => spans[i].outputStart > clamped) - 1)
  const span = spans[index]
  return Math.min(span.source.end, span.source.start + (clamped - span.outputStart) * span.rate)
}

export function outputFrameTimes(map: TimeMap, fps: number): number[] {
  const count = Math.max(1, Math.ceil((map.outputMs * fps) / MS_PER_SECOND - FRAME_COUNT_TOLERANCE))
  return Array.from({ length: count }, (_, i) => (i * MS_PER_SECOND) / fps)
}

export function mapTrack(track: RecordingTrack, map: TimeMap, crop: Rect): RecordingTrack {
  const cursor: CursorSample[] = []
  for (const sample of track.cursor) {
    const t = sourceToOutput(map, sample.t)
    if (t !== null) cursor.push({ ...sample, t, x: sample.x - crop.x, y: sample.y - crop.y })
  }
  const clicks: Click[] = []
  for (const click of track.clicks) {
    const t = sourceToOutput(map, click.t)
    if (t === null) continue
    const up = click.up === null ? null : snapToOutput(map, click.up)
    clicks.push({ ...click, t, up, x: click.x - crop.x, y: click.y - crop.y })
  }
  return { ...track, width: crop.w, height: crop.h, durationMs: map.outputMs, cursor, clicks }
}
