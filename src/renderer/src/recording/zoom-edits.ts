import { clamp, type Point, type Rect } from '../render/geometry'
import { clampFocus, ZOOM_TRANSITION_MS, type ZoomSpeed } from './camera'
import type { TakeView } from './take-view'
import { outputToSource, snapToOutput, type Span, type TimeMap } from './timemap'
import { isShownClick, type Click } from './track'
import { autoHoldLimits, autoZoomsWithClicks, clickGroupsAtDepth, focusOn, ZOOM_RULES, type ZoomSegment } from './zooms'

export type ZoomAim = 'auto' | 'manual'
/** A zoom as the shot stores it: its hold in source ms, its focus in video px. */
export interface ZoomEdit { id: string; start: number; end: number; depth: number; aim: ZoomAim; focus: Point }

export const ZOOM_DEPTH_RANGE = { min: 1.2, max: 3 }
export const NEW_ZOOM = { holdMs: 2000, depth: 2 }
export const MIN_MAPPED_HOLD_MS = 300

const AUTOMATIC_ID_PREFIX = 'auto-'

export const isAutomaticZoomId = (id: string) => id.startsWith(AUTOMATIC_ID_PREFIX)

interface MappedZoom { edit: ZoomEdit; start: number; end: number }

export function editsFromSegments(segments: ZoomSegment[], map: TimeMap, crop: Rect): ZoomEdit[] {
  return segments.map(({ start, end, depth, focus }, i): ZoomEdit => ({
    id: `${AUTOMATIC_ID_PREFIX}${i}`,
    start: outputToSource(map, start),
    end: outputToSource(map, end),
    depth,
    aim: 'auto',
    focus: { x: focus.x + crop.x, y: focus.y + crop.y }
  }))
}

/** Mapping source ms to output ms and back can leave a time a hair off. */
const SAME_TIME_MS = 1e-6
const sameTime = (a: number, b: number) => Math.abs(a - b) <= SAME_TIME_MS
const takesIn = (span: Span, t: number) => span.start <= t && t <= span.end

const mappedInTimeOrder = (edits: ZoomEdit[], map: TimeMap): MappedZoom[] =>
  edits.map((edit) => ({ edit, start: snapToOutput(map, edit.start), end: snapToOutput(map, edit.end) })).sort((a, b) => a.start - b.start)

/** From the settle time before the zoom to its end, or on to the video's end while its end sits where the last second's clamp puts it. */
function windowOf(zoom: MappedZoom, lastHoldEnd: number, outputMs: number, speed: ZoomSpeed): Span {
  return { start: zoom.start - ZOOM_TRANSITION_MS[speed], end: sameTime(zoom.end, lastHoldEnd) ? outputMs : zoom.end }
}

/** A shown click belongs to the zoom that holds it, or else to the first zoom whose window takes it in. */
function clicksByWindow(zooms: MappedZoom[], view: Pick<TakeView, 'map' | 'frame' | 'track'>, speed: ZoomSpeed): Click[][] {
  const { outputMs } = view.map
  const lastHoldEnd = autoHoldLimits({ start: 0, end: outputMs }, speed).end
  const windows = zooms.map((zoom) => windowOf(zoom, lastHoldEnd, outputMs, speed))
  const owned = zooms.map((): Click[] => [])
  for (const click of view.track.clicks) {
    if (!isShownClick(click, view.frame)) continue
    const holder = zooms.findIndex((zoom) => takesIn(zoom, click.t))
    const index = holder !== -1 ? holder : windows.findIndex((window) => takesIn(window, click.t))
    if (index !== -1) owned[index].push(click)
  }
  return owned
}

/** A zoom that keeps an automatic zoom's hold keeps the clicks that zoom was found from, so storing the automatic zooms moves none of them. */
function clicksByZoom(zooms: MappedZoom[], view: Pick<TakeView, 'map' | 'frame' | 'track'>, speed: ZoomSpeed): Click[][] {
  const found = autoZoomsWithClicks(view.track.clicks, view.frame, { start: 0, end: view.map.outputMs }, speed)
  const byWindow = clicksByWindow(zooms, view, speed)
  return zooms.map((zoom, i) => found.find((automatic) => sameTime(automatic.start, zoom.start) && sameTime(automatic.end, zoom.end))?.clicks ?? byWindow[i])
}

/** Just before the group's first click, unless the move there, which waits for the last click of the group before, arrives later. */
function arrivalAt(group: Click[], previous: Click[], speed: ZoomSpeed): number {
  return Math.max(group[0].t - ZOOM_RULES.preClickMs, previous[previous.length - 1].t + ZOOM_TRANSITION_MS[speed])
}

function aimedSegment({ edit, start, end }: MappedZoom, clicks: Click[], view: Pick<TakeView, 'crop' | 'frame'>, speed: ZoomSpeed): ZoomSegment {
  const { depth } = edit
  const { crop, frame } = view
  if (edit.aim === 'manual' || clicks.length === 0) {
    return { start, end, depth, focus: clampFocus({ x: edit.focus.x - crop.x, y: edit.focus.y - crop.y }, depth, frame) }
  }
  const groups = clickGroupsAtDepth(clicks, frame, depth)
  const segment = { start, end, depth, focus: focusOn(groups[0], frame, depth) }
  if (groups.length === 1) return segment
  const follow = groups.slice(1).map((group, i) => ({ at: arrivalAt(group, groups[i], speed), focus: focusOn(group, frame, depth) }))
  return { ...segment, follow }
}

export function segmentsFromEdits(edits: ZoomEdit[], view: Pick<TakeView, 'map' | 'crop' | 'frame' | 'track'>, speed: ZoomSpeed): ZoomSegment[] {
  const zooms = mappedInTimeOrder(edits, view.map)
  const covered = clicksByZoom(zooms, view, speed)
  return zooms.flatMap((zoom, i) => (zoom.end - zoom.start < MIN_MAPPED_HOLD_MS ? [] : [aimedSegment(zoom, covered[i], view, speed)]))
}

/** The clicks that aim the zoom when it is Auto, in output ms and frame px. */
export function clicksCovered(edit: ZoomEdit, view: Pick<TakeView, 'map' | 'frame' | 'track' | 'edits'>, speed: ZoomSpeed): Click[] {
  const zooms = mappedInTimeOrder([edit, ...view.edits.filter((other) => other.id !== edit.id)], view.map)
  return clicksByZoom(zooms, view, speed)[zooms.findIndex((zoom) => zoom.edit === edit)]
}

export function materialize(edits: ZoomEdit[], newId: () => string): { edits: ZoomEdit[]; ids: Map<string, string> } {
  const ids = new Map<string, string>()
  const stored = edits.map((edit) => {
    if (!isAutomaticZoomId(edit.id)) return edit
    const id = newId()
    ids.set(edit.id, id)
    return { ...edit, id }
  })
  return { edits: stored, ids }
}

const replacing = (edits: ZoomEdit[], zoom: ZoomEdit) => edits.map((edit) => (edit.id === zoom.id ? zoom : edit))

/** Where a zoom may go: from the end of the zooms before it to the start of those after it, inside the bounds. */
function roomOf(edits: ZoomEdit[], zoom: ZoomEdit, bounds: Span): Span {
  const others = edits.filter((other) => other.id !== zoom.id)
  return {
    start: Math.max(bounds.start, ...others.filter((other) => other.start < zoom.start).map((other) => other.end)),
    end: Math.min(bounds.end, ...others.filter((other) => other.start >= zoom.start).map((other) => other.start))
  }
}

export function moveZoom(edits: ZoomEdit[], id: string, start: number, bounds: Span): ZoomEdit[] {
  const zoom = edits.find((edit) => edit.id === id)
  if (!zoom) return edits
  const room = roomOf(edits, zoom, bounds)
  const length = zoom.end - zoom.start
  if (room.end - room.start < length) return edits
  const movedStart = clamp(start, room.start, room.end - length)
  return replacing(edits, { ...zoom, start: movedStart, end: movedStart + length })
}

export function stretchZoom(edits: ZoomEdit[], id: string, edge: 'start' | 'end', at: number, bounds: Span): ZoomEdit[] {
  const zoom = edits.find((edit) => edit.id === id)
  if (!zoom) return edits
  const room = roomOf(edits, zoom, bounds)
  if (edge === 'start') {
    const latest = zoom.end - ZOOM_RULES.minHoldMs
    return room.start > latest ? edits : replacing(edits, { ...zoom, start: clamp(at, room.start, latest) })
  }
  const earliest = zoom.start + ZOOM_RULES.minHoldMs
  return earliest > room.end ? edits : replacing(edits, { ...zoom, end: clamp(at, earliest, room.end) })
}

export function addZoom(edits: ZoomEdit[], at: number, focus: Point, bounds: Span, id: string): ZoomEdit[] | null {
  const from = Math.max(at, bounds.start)
  const start = edits.find((edit) => edit.start <= from && from < edit.end)?.end ?? from
  const nextStarts = edits.filter((edit) => edit.start >= start).map((edit) => edit.start)
  const end = Math.min(start + NEW_ZOOM.holdMs, bounds.end, ...nextStarts)
  if (end - start < ZOOM_RULES.minHoldMs) return null
  const added: ZoomEdit = { id, start, end, depth: NEW_ZOOM.depth, aim: 'manual', focus }
  return [...edits, added].sort((a, b) => a.start - b.start)
}

export function removeZoom(edits: ZoomEdit[], id: string): ZoomEdit[] {
  return edits.filter((edit) => edit.id !== id)
}

export function setZoom(edits: ZoomEdit[], id: string, patch: Partial<Pick<ZoomEdit, 'depth' | 'aim' | 'focus'>>): ZoomEdit[] {
  return edits.map((edit) => {
    if (edit.id !== id) return edit
    const changed = { ...edit, ...patch }
    return { ...changed, depth: clamp(changed.depth, ZOOM_DEPTH_RANGE.min, ZOOM_DEPTH_RANGE.max) }
  })
}
