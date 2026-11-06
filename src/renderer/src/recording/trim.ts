import { isInFrame, type CursorSample, type RecordingTrack } from './track'

export interface Trim { start: number; end: number }

export const TRIM_RULES = { restMs: 300, shortcutTailMs: 200, stillPx: 2, minLengthMs: 500 }

interface Rest { start: number; end: number; lastsToEnd: boolean }

function lastRest(cursor: CursorSample[], durationMs: number): Rest | null {
  let last: Rest | null = null
  let from = 0
  while (from < cursor.length) {
    let next = from + 1
    while (next < cursor.length && Math.hypot(cursor[next].x - cursor[from].x, cursor[next].y - cursor[from].y) < TRIM_RULES.stillPx) next++
    const lastsToEnd = next === cursor.length
    const end = lastsToEnd ? durationMs : cursor[next - 1].t
    if (end - cursor[from].t >= TRIM_RULES.restMs) last = { start: cursor[from].t, end, lastsToEnd }
    from = next
  }
  return last
}

export function autoTrim(track: RecordingTrack): Trim {
  const rest = lastRest(track.cursor, track.durationMs)
  let end = track.durationMs
  if (rest?.lastsToEnd) end = track.durationMs - TRIM_RULES.shortcutTailMs
  else if (rest && !track.clicks.some((click) => click.t >= rest.end && isInFrame(click, track))) end = rest.end
  return clampTrim({ start: 0, end }, track.durationMs)
}

export function clampTrim(trim: Trim, durationMs: number): Trim {
  if (trim.start >= trim.end) return { start: 0, end: durationMs }
  const start = Math.min(Math.max(trim.start, 0), durationMs)
  let end = Math.min(Math.max(trim.end, start), durationMs)
  const minLength = Math.min(TRIM_RULES.minLengthMs, durationMs)
  if (end - start >= minLength) return { start, end }
  end = Math.min(durationMs, start + TRIM_RULES.minLengthMs)
  return { start: Math.max(0, end - TRIM_RULES.minLengthMs), end }
}
