import { clipTo, confineMove, normalize, rect, resizeRect, type Handle, type Point, type Rect } from '../render/geometry'
import type { Layout } from '../render/layout'

export const MIN_ITEM = 6

/** What maps export px to image px: the pointer's points are export px in the shot, the boxes are image px. */
export type BoxFrame = Pick<Layout, 'sel' | 'content' | 'scale'>

export const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return rect(x, y, Math.max(a.x + a.w, b.x + b.w) - x, Math.max(a.y + a.h, b.y + b.h) - y)
}

/** The boxes moved together by the pointer's travel from `start`, all of them kept on the image. */
export function movedRects(rects: Rect[], start: Point, pointer: Point, frame: BoxFrame, full: Rect): Rect[] {
  const bounds = rects.reduce(union)
  const moved = confineMove(
    { ...bounds, x: bounds.x + (pointer.x - start.x) / frame.scale, y: bounds.y + (pointer.y - start.y) / frame.scale },
    full
  )
  const dx = moved.x - bounds.x
  const dy = moved.y - bounds.y
  return rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }))
}

export function resizedRect(start: Rect, handle: Handle, from: Point, pointer: Point, frame: BoxFrame, full: Rect): Rect {
  return clipTo(resizeRect(start, handle, (pointer.x - from.x) / frame.scale, (pointer.y - from.y) / frame.scale, MIN_ITEM), full)
}

/** From the press to the pointer, both in export px. */
export function drawnRect(start: Point, pointer: Point, frame: BoxFrame, full: Rect): Rect {
  return clipTo(
    normalize(
      rect(
        frame.sel.x + (start.x - frame.content.x) / frame.scale,
        frame.sel.y + (start.y - frame.content.y) / frame.scale,
        (pointer.x - start.x) / frame.scale,
        (pointer.y - start.y) / frame.scale
      )
    ),
    full
  )
}

/** A press made while the canvas showed the zoomed camera has no travel to measure once the canvas turns wide, so the first wide point becomes the anchor. */
export function anchoredAt(drag: { start: Point; anchored: boolean }, pointer: Point, wide: boolean): { start: Point; anchored: boolean } {
  return drag.anchored || !wide ? { start: drag.start, anchored: drag.anchored } : { start: pointer, anchored: true }
}
