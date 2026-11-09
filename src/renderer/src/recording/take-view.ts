import type { Rect, Size } from '../render/geometry'
import type { ZoomSpeed } from './camera'
import { buildCursorPath, type CursorPath } from './cursor'
import type { RecordingEntry } from './registry'
import type { RecordingDoc } from './settings'
import { mapTrack, snapToOutput, timeMapOf, type Piece, type TimeMap } from './timemap'
import type { CursorSample, RecordingTrack } from './track'
import type { Trim } from './trim'
import { autoZooms, type ZoomSegment } from './zooms'

/** The take as it plays, in output ms and frame px. */
export interface TakeView {
  map: TimeMap
  crop: Rect
  frame: Size
  track: RecordingTrack
  zooms: ZoomSegment[]
  cursor: CursorPath
}

type MappedTake = Pick<TakeView, 'map' | 'crop' | 'frame' | 'track'>

interface BuiltView {
  trim: Trim
  pieces: Piece[]
  crop: Rect
  zoomSpeed: ZoomSpeed
  smoothing: number
  view: TakeView
}

const builtViews = new WeakMap<RecordingTrack, BuiltView>()

export const cropOf = (crop: Rect | null, video: Size): Rect => crop ?? { x: 0, y: 0, w: video.width, h: video.height }

const sameTrim = (a: Trim, b: Trim) => a.start === b.start && a.end === b.end
const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
const samePiece = (a: Piece, b: Piece) => a.start === b.start && a.end === b.end && a.rate === b.rate && a.cut === b.cut
const samePieces = (a: Piece[], b: Piece[]) => a === b || (a.length === b.length && a.every((piece, i) => samePiece(piece, b[i])))

function firstIndexAfter(cursor: CursorSample[], t: number): number {
  let low = 0
  let high = cursor.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (cursor[middle].t > t) high = middle
    else low = middle + 1
  }
  return low
}

function sampleAt(cursor: CursorSample[], t: number): CursorSample {
  const following = firstIndexAfter(cursor, t)
  const before = cursor[following - 1]
  const after = cursor[following]
  if (!before) return { ...after, t }
  if (!after || before.t === t) return { ...before, t }
  const progress = (t - before.t) / (after.t - before.t)
  return { t, x: before.x + (after.x - before.x) * progress, y: before.y + (after.y - before.y) * progress, shape: before.shape }
}

function keptCursor(cursor: CursorSample[], map: TimeMap): CursorSample[] {
  if (cursor.length === 0) return []
  const kept: CursorSample[] = []
  for (const { source } of map.spans) {
    if (kept.at(-1)?.t !== source.start) kept.push(sampleAt(cursor, source.start))
    for (let i = firstIndexAfter(cursor, source.start); i < cursor.length && cursor[i].t < source.end; i++) kept.push(cursor[i])
    kept.push(sampleAt(cursor, source.end))
  }
  return kept
}

function mappedTake(track: RecordingTrack, trim: Trim, pieces: Piece[], crop: Rect): MappedTake {
  const map = timeMapOf(trim, pieces)
  // mapTrack drops the samples outside the kept spans, but the cursor needs a place at output 0 and on both sides of every seam.
  const cursor = keptCursor(track.cursor, map).map((sample) => ({
    ...sample,
    t: snapToOutput(map, sample.t),
    x: sample.x - crop.x,
    y: sample.y - crop.y
  }))
  return {
    map,
    crop,
    frame: { width: crop.w, height: crop.h },
    track: { ...mapTrack({ ...track, cursor: [] }, map, crop), cursor }
  }
}

/** Built once per edit state of a take; a change rebuilds only what depends on it. */
export function takeViewFor(entry: RecordingEntry, recording: RecordingDoc, crop: Rect | null): TakeView {
  const { trim, pieces, zoomSpeed, smoothing } = recording
  const frameCrop = cropOf(crop, entry.track)
  const built = builtViews.get(entry.track)
  const sameTake = built !== undefined && sameTrim(built.trim, trim) && samePieces(built.pieces, pieces) && sameRect(built.crop, frameCrop)
  const sameZooms = sameTake && built.zoomSpeed === zoomSpeed
  const sameCursor = sameTake && built.smoothing === smoothing
  if (sameZooms && sameCursor) return built.view

  const take: MappedTake = sameTake ? built.view : mappedTake(entry.track, trim, pieces, frameCrop)
  const view: TakeView = {
    map: take.map,
    crop: take.crop,
    frame: take.frame,
    track: take.track,
    zooms: sameZooms ? built.view.zooms : autoZooms(take.track.clicks, take.frame, { start: 0, end: take.map.outputMs }, zoomSpeed),
    cursor: sameCursor ? built.view.cursor : buildCursorPath(take.track, smoothing)
  }
  builtViews.set(entry.track, { trim, pieces, crop: frameCrop, zoomSpeed, smoothing, view })
  return view
}
