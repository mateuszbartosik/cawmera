import type { Trim } from './trim'

/** A video that stopped within this many ms of the trim end counts as finished, so Play starts over. */
const END_TOLERANCE_MS = 50

export function playbackStart(time: number, trim: Trim, finished: boolean): number {
  const outside = time < trim.start || time >= trim.end - END_TOLERANCE_MS
  return finished || outside ? trim.start : time
}

export function hasReachedEnd(time: number, trim: Trim): boolean {
  return time >= trim.end
}

export function clampToTrim(time: number, trim: Trim): number {
  return Math.min(Math.max(time, trim.start), trim.end)
}
