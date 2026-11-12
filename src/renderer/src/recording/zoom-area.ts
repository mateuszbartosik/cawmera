import { clamp, confineMove, contains, handlePoint, rect, type Point, type Rect, type Size } from '../render/geometry'
import type { TakeView } from './take-view'
import { snapToOutput } from './timemap'
import type { Click } from './track'
import { ZOOM_DEPTH_RANGE, type ZoomEdit } from './zoom-edits'
import { clickGroupsAtDepth, focusOn } from './zooms'

export type Corner = 'nw' | 'ne' | 'se' | 'sw'
export type AreaGrab = Corner | 'move'
/** The area in frame px, and the clicks it shows, as the take view has them. */
export interface AimedArea { area: Rect; clicks: Click[] }

export const CORNERS: Corner[] = ['nw', 'ne', 'se', 'sw']

const OUTWARD: Record<Corner, Point> = { nw: { x: -1, y: -1 }, ne: { x: 1, y: -1 }, se: { x: 1, y: 1 }, sw: { x: -1, y: 1 } }

/** The part of the frame a zoom shows, in frame px. */
export function areaOf(focus: Point, depth: number, frame: Size): Rect {
  const w = frame.width / depth
  const h = frame.height / depth
  return { x: clamp(focus.x - w / 2, 0, frame.width - w), y: clamp(focus.y - h / 2, 0, frame.height - h), w, h }
}

export const focusOf = (area: Rect): Point => ({ x: area.x + area.w / 2, y: area.y + area.h / 2 })

export const depthOf = (area: Rect, frame: Size) => frame.width / area.w

export function moveArea(start: Rect, dx: number, dy: number, frame: Size): Rect {
  return confineMove({ ...start, x: start.x + dx, y: start.y + dy }, rect(0, 0, frame.width, frame.height))
}

/**
 * Keeps the frame’s shape and the opposite corner. The axis that moves the corner more sets the size, unless one axis pulls
 * the corner out while the other pushes it in: then their moves add up, so the size never jumps.
 */
export function resizeArea(start: Rect, corner: Corner, dx: number, dy: number, frame: Size, range: { min: number; max: number }): Rect {
  const outward = OUTWARD[corner]
  const fixed = { x: outward.x > 0 ? start.x : start.x + start.w, y: outward.y > 0 ? start.y : start.y + start.h }
  const widthFor = (height: number) => (height * frame.width) / frame.height
  const growX = dx * outward.x
  const growY = widthFor(dy * outward.y)
  const grow = growX * growY < 0 ? growX + growY : Math.abs(growX) >= Math.abs(growY) ? growX : growY
  const roomX = outward.x > 0 ? frame.width - fixed.x : fixed.x
  const roomY = outward.y > 0 ? frame.height - fixed.y : fixed.y
  const w = clamp(start.w + grow, frame.width / range.max, Math.min(frame.width / range.min, roomX, widthFor(roomY)))
  const h = (w * frame.height) / frame.width
  return { x: outward.x > 0 ? fixed.x : fixed.x - w, y: outward.y > 0 ? fixed.y : fixed.y - h, w, h }
}

/** The nearest corner within `tolerance` of the point wins over the inside. */
export function areaGrabAt(area: Rect, p: Point, tolerance: number): AreaGrab | null {
  const offsets = CORNERS.map((corner) => {
    const at = handlePoint(area, corner)
    return { corner, x: Math.abs(at.x - p.x), y: Math.abs(at.y - p.y) }
  })
  const nearest = offsets.filter(({ x, y }) => x <= tolerance && y <= tolerance).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0]
  return nearest?.corner ?? (contains(area, p) ? 'move' : null)
}

/** How a zoom frames the shot once its area is dragged by (dx, dy) frame px: a focus in video px, and a depth when a corner was dragged. */
export function draggedFraming(
  start: Rect,
  grab: AreaGrab,
  dx: number,
  dy: number,
  view: Pick<TakeView, 'crop' | 'frame'>
): Pick<ZoomEdit, 'focus'> & Partial<Pick<ZoomEdit, 'depth'>> {
  const { crop, frame } = view
  const area = grab === 'move' ? moveArea(start, dx, dy, frame) : resizeArea(start, grab, dx, dy, frame, ZOOM_DEPTH_RANGE)
  const centre = focusOf(area)
  const focus = { x: centre.x + crop.x, y: centre.y + crop.y }
  return grab === 'move' ? { focus } : { focus, depth: depthOf(area, frame) }
}

/**
 * A Manual zoom, or one that covers no clicks, shows its focus and every click it covers. An Auto zoom shows the group of
 * clicks it is on at the playhead (source ms) while it holds, and its first group otherwise.
 */
export function aimedArea(edit: ZoomEdit, covered: Click[], view: Pick<TakeView, 'map' | 'crop' | 'frame'>, playhead: number): AimedArea {
  const { map, crop, frame } = view
  if (edit.aim === 'manual' || covered.length === 0) {
    return { area: areaOf({ x: edit.focus.x - crop.x, y: edit.focus.y - crop.y }, edit.depth, frame), clicks: covered }
  }
  const groups = clickGroupsAtDepth(covered, frame, edit.depth)
  const t = snapToOutput(map, playhead)
  const holding = snapToOutput(map, edit.start) <= t && t <= snapToOutput(map, edit.end)
  const group = (holding ? groups.findLast((candidate) => candidate[0].t <= t) : undefined) ?? groups[0]
  return { area: areaOf(focusOn(group, frame, edit.depth), edit.depth, frame), clicks: group }
}
