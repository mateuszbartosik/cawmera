import type { Span } from '../recording/timemap'
import type { ZoomEdit } from '../recording/zoom-edits'
import { timeToX, xToTime, type TimelineView } from './scale'

export const MIN_ZOOM_BLOCK_PX = 28
export const EDGE_GRAB_PX = 7

export interface Grab { kind: 'move' | 'start' | 'end'; offsetMs: number }

/** Where a zoom's block is drawn: never narrower than a grabbable block. */
export function drawnBlock(zoom: Span, view: TimelineView, width: number): { left: number; width: number } {
  const left = timeToX(zoom.start, view, width)
  return { left, width: Math.max(MIN_ZOOM_BLOCK_PX, timeToX(zoom.end, view, width) - left) }
}

export const isBlockVisible = (block: { left: number; width: number }, rowWidth: number) => block.left + block.width > 0 && block.left < rowWidth

/** What a press at `x` (row pixels) takes hold of. The offset is from the pointer to the zoom's own edge, so the first move never jumps, even on a block drawn wider than its zoom. */
export function grabAt(zoom: Span, x: number, view: TimelineView, width: number): Grab {
  const block = drawnBlock(zoom, view, width)
  const pressed = xToTime(x, view, width)
  const inBlock = x - block.left
  if (inBlock < EDGE_GRAB_PX) return { kind: 'start', offsetMs: pressed - zoom.start }
  if (inBlock > block.width - EDGE_GRAB_PX) return { kind: 'end', offsetMs: pressed - zoom.end }
  return { kind: 'move', offsetMs: pressed - zoom.start }
}

/** The time, in source ms, the grabbed start or end of the zoom goes to when the pointer is at `x`. */
export const dragTarget = (grab: Grab, x: number, view: TimelineView, width: number) => xToTime(x, view, width) - grab.offsetMs

/** The zoom whose drawn block covers `x` (row pixels), if any; the topmost when drawn blocks overlap. */
export function zoomAtX(edits: ZoomEdit[], x: number, view: TimelineView, width: number): ZoomEdit | null {
  return (
    edits.findLast((zoom) => {
      const block = drawnBlock(zoom, view, width)
      return x >= block.left && x <= block.left + block.width
    }) ?? null
  )
}
