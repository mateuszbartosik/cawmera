import { CLICK_EFFECT_MS } from './effects'
import { isInFrame, type Click, type CursorSample, type RecordingTrack } from './track'

export interface Trim { start: number; end: number }

export const TRIM_RULES = { restMs: 300, shortcutTailMs: 200, stillPx: 2, minLengthMs: 500, stopWaitPx: 200 }

const LONGEST_CLICK_EFFECT_MS = Math.max(...Object.values(CLICK_EFFECT_MS))

interface Rest { start: number; end: number; lastsToEnd: boolean }

function lastRest(cursor: CursorSample[], endMs: number): Rest | null {
  let last: Rest | null = null
  let from = 0
  while (from < cursor.length) {
    let next = from + 1
    while (next < cursor.length && Math.hypot(cursor[next].x - cursor[from].x, cursor[next].y - cursor[from].y) < TRIM_RULES.stillPx) next++
    const lastsToEnd = next === cursor.length
    const end = lastsToEnd ? endMs : cursor[next - 1].t
    if (end - cursor[from].t >= TRIM_RULES.restMs) last = { start: cursor[from].t, end, lastsToEnd }
    from = next
  }
  return last
}

function endBeforeTaskbarStop(track: RecordingTrack, stopClick: Click): number {
  const nearPx = TRIM_RULES.stopWaitPx * track.scale
  const isNearStopClick = (sample: CursorSample) => Math.hypot(sample.x - stopClick.x, sample.y - stopClick.y) <= nearPx
  let waitStart = track.cursor.length
  while (waitStart > 0 && isNearStopClick(track.cursor[waitStart - 1])) waitStart--
  const waitStartMs = waitStart < track.cursor.length ? Math.min(track.cursor[waitStart].t, stopClick.t) : stopClick.t
  const beforeWait = track.cursor.filter((sample) => sample.t < waitStartMs)
  const rest = lastRest(beforeWait, beforeWait.at(-1)?.t ?? 0)
  const lastClick = track.clicks.filter((click) => click.t < waitStartMs && isInFrame(click, track)).at(-1)
  if (!rest && !lastClick) return waitStartMs
  const lastClickLanded = lastClick ? Math.min(lastClick.t + LONGEST_CLICK_EFFECT_MS, waitStartMs) : 0
  return Math.max(rest?.end ?? 0, lastClickLanded)
}

export function autoTrim(track: RecordingTrack, stopClick: Click | null = null): Trim {
  if (stopClick) return clampTrim({ start: 0, end: endBeforeTaskbarStop(track, stopClick) }, track.durationMs)
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
