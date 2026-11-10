import type { Rect, Size } from '../render/geometry'
import { firstIndexWhere } from './binary-search'
import { buildCameraPath, cameraTargets, type CameraPath, type ZoomSpeed } from './camera'
import { buildCursorPath, CURSOR_RULES, type CursorPath } from './cursor'
import { LONGEST_CLICK_EFFECT_MS, PRESS } from './effects'
import type { RecordingEntry } from './registry'
import type { RecordingDoc } from './settings'
import { mapTrack, preRollToOutput, timeMapOf, type Piece, type TimeMap } from './timemap'
import type { Click, CursorSample, RecordingTrack } from './track'
import type { Trim } from './trim'
import { editsFromSegments, segmentsFromEdits, type ZoomEdit } from './zoom-edits'
import { autoZooms, type ZoomSegment } from './zooms'

/** The take as it plays, in output ms and frame px. */
export interface TakeView {
  map: TimeMap
  crop: Rect
  frame: Size
  track: RecordingTrack
  /** The track's clicks, and those just before the video whose ring or press still runs at its start. */
  effectClicks: Click[]
  zooms: ZoomSegment[]
  /** The zooms the shot stores, or the automatic ones until it stores any, in source ms and video px. */
  edits: ZoomEdit[]
  camera: CameraPath
  cursor: CursorPath
}

interface MappedTake extends Pick<TakeView, 'map' | 'crop' | 'frame' | 'track' | 'effectClicks'> {
  trackWithPreRoll: RecordingTrack
}

interface BuiltView {
  trim: Trim
  pieces: Piece[]
  crop: Rect
  zoomSpeed: ZoomSpeed
  storedZooms: ZoomEdit[] | null
  smoothing: number
  take: MappedTake
  view: TakeView
}

const PRE_ROLL_MS = CURSOR_RULES.stillAfterMs + CURSOR_RULES.fadeMs + CURSOR_RULES.showBeforeMoveMs

const builtViews = new WeakMap<RecordingTrack, BuiltView>()

export const cropOf = (crop: Rect | null, video: Size): Rect => crop ?? { x: 0, y: 0, w: video.width, h: video.height }

const sameTrim = (a: Trim, b: Trim) => a.start === b.start && a.end === b.end
const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
const samePiece = (a: Piece, b: Piece) => a.start === b.start && a.end === b.end && a.rate === b.rate && a.cut === b.cut
const samePieces = (a: Piece[], b: Piece[]) => a === b || (a.length === b.length && a.every((piece, i) => samePiece(piece, b[i])))

function sampleAt(cursor: CursorSample[], t: number): CursorSample {
  const following = firstIndexWhere(cursor.length, (i) => cursor[i].t > t)
  const before = cursor[following - 1]
  const after = cursor[following]
  if (!before) return { ...after, t }
  if (!after || before.t === t) return { ...before, t }
  const progress = (t - before.t) / (after.t - before.t)
  return { t, x: before.x + (after.x - before.x) * progress, y: before.y + (after.y - before.y) * progress, shape: before.shape }
}

/** Every kept span's samples, plus the take's place where a span starts after a seam and where each span ends. */
function playedCursor(cursor: CursorSample[], map: TimeMap): CursorSample[] {
  const played: CursorSample[] = []
  if (cursor.length === 0) return played
  map.spans.forEach(({ source }, index) => {
    const afterSeam = index > 0
    if (afterSeam && played.at(-1)?.t !== source.start) played.push(sampleAt(cursor, source.start))
    const from = firstIndexWhere(cursor.length, (i) => (afterSeam ? cursor[i].t > source.start : cursor[i].t >= source.start))
    for (let i = from; i < cursor.length && cursor[i].t < source.end; i++) played.push(cursor[i])
    played.push(sampleAt(cursor, source.end))
  })
  return played
}

function mappedTake(track: RecordingTrack, trim: Trim, pieces: Piece[], crop: Rect): MappedTake {
  const map = timeMapOf(trim, pieces)
  const start = map.spans[0]?.source.start ?? Number.NEGATIVE_INFINITY
  const inPreRoll = (t: number) => t < start && preRollToOutput(map, t) >= -PRE_ROLL_MS
  const sampleInOutput = (sample: CursorSample): CursorSample =>
    ({ ...sample, t: preRollToOutput(map, sample.t), x: sample.x - crop.x, y: sample.y - crop.y })
  const clickInOutput = (click: Click): Click => ({
    ...click,
    t: preRollToOutput(map, click.t),
    up: click.up === null ? null : preRollToOutput(map, click.up),
    x: click.x - crop.x,
    y: click.y - crop.y
  })
  const clicksBefore = track.clicks.filter((click) => click.t < start).map(clickInOutput)
  const stillShowsAtStart = (click: Click) =>
    click.button === 'left' && (click.t > -LONGEST_CLICK_EFFECT_MS || click.up === null || click.up > -PRESS.ms)

  // mapTrack would keep only the samples inside the kept spans, with no place at a seam or at the end.
  const played = { ...mapTrack({ ...track, cursor: [] }, map, crop), cursor: playedCursor(track.cursor, map).map(sampleInOutput) }
  return {
    map,
    crop,
    frame: { width: crop.w, height: crop.h },
    track: played,
    effectClicks: [...clicksBefore.filter(stillShowsAtStart), ...played.clicks],
    trackWithPreRoll: {
      ...played,
      cursor: [...track.cursor.filter((sample) => inPreRoll(sample.t)).map(sampleInOutput), ...played.cursor],
      clicks: [...clicksBefore.filter((click) => click.t >= -PRE_ROLL_MS), ...played.clicks]
    }
  }
}

/** Stored zooms are aimed in the take. Automatic ones drive the camera just as found and stand in as edits until the first edit. */
function zoomsOf(take: MappedTake, storedZooms: ZoomEdit[] | null, speed: ZoomSpeed): Pick<TakeView, 'zooms' | 'edits'> {
  if (storedZooms) return { zooms: segmentsFromEdits(storedZooms, take, speed), edits: storedZooms }
  const zooms = autoZooms(take.track.clicks, take.frame, { start: 0, end: take.map.outputMs }, speed)
  return { zooms, edits: editsFromSegments(zooms, take.map, take.crop) }
}

/** Built once per edit state of a take; a change rebuilds only what depends on it. */
export function takeViewFor(entry: RecordingEntry, recording: RecordingDoc, crop: Rect | null): TakeView {
  const { trim, pieces, zooms: storedZooms, zoomSpeed, smoothing } = recording
  const frameCrop = cropOf(crop, entry.track)
  const built = builtViews.get(entry.track)
  const sameTake = built !== undefined && sameTrim(built.trim, trim) && samePieces(built.pieces, pieces) && sameRect(built.crop, frameCrop)
  const sameZooms = sameTake && built.zoomSpeed === zoomSpeed && built.storedZooms === storedZooms
  const sameCursor = sameTake && built.smoothing === smoothing
  if (sameZooms && sameCursor) return built.view

  const take = sameTake ? built.take : mappedTake(entry.track, trim, pieces, frameCrop)
  const { zooms, edits } = sameZooms ? built.view : zoomsOf(take, storedZooms, zoomSpeed)
  const view: TakeView = {
    map: take.map,
    crop: take.crop,
    frame: take.frame,
    track: take.track,
    effectClicks: take.effectClicks,
    zooms,
    edits,
    camera: sameZooms ? built.view.camera : buildCameraPath(cameraTargets(zooms, take.frame, zoomSpeed), zoomSpeed, take.frame),
    cursor: sameCursor ? built.view.cursor : buildCursorPath(take.trackWithPreRoll, smoothing)
  }
  builtViews.set(entry.track, { trim, pieces, crop: frameCrop, zoomSpeed, storedZooms, smoothing, take, view })
  return view
}
