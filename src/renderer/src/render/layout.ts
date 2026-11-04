import { edgeDirections, type Direction, type Edge } from '../app/doc'
import { OUTPUT, uiScale, type HouseStyle } from '../app/house-style'
import { clipTo, intersect, normalize, rect, resizeRect, type Handle, type Point, type Rect } from './geometry'

export interface Size {
  width: number
  height: number
}

/**
 * Where the screenshot lands in the 1600×1000 output.
 *
 * Scale is never "fit": it comes only from how the shot was captured, the UI zoom and the house
 * design width, so every image shows the captured UI at the same size.
 *
 * The frame shows one selection of the screenshot. Per axis, the edge decides where it sits:
 * - coming in from a side, the screenshot touches that edge and its frame runs off it; at most
 *   `size - inset` of it shows, keeping the inset on the opposite side;
 * - otherwise it is centered and stays fully inside, with the inset on both sides.
 * Without an explicit edge, an axis comes in from the right / bottom only when the selection is
 * bigger than the inside area, and is centered otherwise.
 */
export interface Layout {
  /** Export px per source px. */
  scale: number
  image: Size
  /** The edge actually used (the automatic one when the document has none). */
  edge: Edge
  /** The framed part of the screenshot, source px. Always fully visible. */
  sel: Rect
  /** Where `sel` is drawn, export px. Always inside the output. */
  content: Rect
  /** The rounded frame, export px. On the sides it comes in from, it runs past the output edge. */
  frame: Rect
}

/** How far a frame runs past the output edge it comes in from, so no border or corner shows there. */
export const BLEED_OVERSHOOT = 64

export const OUTPUT_RECT: Rect = rect(0, 0, OUTPUT.width, OUTPUT.height)

export function contentScale(capturedAt: number, zoom: number, exportPerCssPx: number = OUTPUT.scale): number {
  return (exportPerCssPx / capturedAt) * zoom
}

export function scaleFor(capturedAt: number, zoom: number, style: Pick<HouseStyle, 'designWidth'>): number {
  return contentScale(capturedAt, zoom, uiScale(style))
}

const full = (image: Size): Rect => rect(0, 0, image.width, image.height)

/** Export px available along one axis: one inset when coming in from a side, two when inside. */
const room = (total: number, inset: number, dir: Direction) => total - (dir === 0 ? 2 * inset : inset)

/**
 * The most of the screenshot (source px) the frame can show. With no explicit edge, the automatic
 * edge comes in from a side as soon as the selection needs it, so the larger limit applies.
 */
export function capacity(scale: number, style: Pick<HouseStyle, 'inset'>, edge: Edge | null): Size {
  const dirs = edge ? edgeDirections(edge) : { x: 1 as Direction, y: 1 as Direction }
  return { width: room(OUTPUT.width, style.inset, dirs.x) / scale, height: room(OUTPUT.height, style.inset, dirs.y) / scale }
}

/** The stored selection clipped to the image, or the whole image. */
export function baseSelection(crop: Rect | null, image: Size): Rect {
  if (!crop) return full(image)
  const clipped = intersect(crop, full(image))
  return clipped && clipped.w >= 1 && clipped.h >= 1 ? clipped : full(image)
}

/** Without an explicit edge: come in from the right / bottom only where the selection doesn't fit inside. */
export function autoEdge(selection: Size, scale: number, style: Pick<HouseStyle, 'inset'>): Edge {
  const x = selection.width * scale > room(OUTPUT.width, style.inset, 0) + 0.5
  const y = selection.height * scale > room(OUTPUT.height, style.inset, 0) + 0.5
  return x && y ? 'br' : x ? 'r' : y ? 'b' : 'c'
}

/** The edge a document actually uses. */
export function resolveEdge(edge: Edge | null, crop: Rect | null, image: Size, scale: number, style: Pick<HouseStyle, 'inset'>): Edge {
  if (edge) return edge
  const base = baseSelection(crop, image)
  return autoEdge({ width: base.w, height: base.h }, scale, style)
}

/**
 * What is actually framed: the selection, cut down to what fits. The part that stays is the one
 * next to the visible frame edge, so a screenshot coming in from the left shows its right side.
 */
export function effectiveSelection(crop: Rect | null, image: Size, cap: Size, edge: Edge): Rect {
  const base = baseSelection(crop, image)
  const dirs = edgeDirections(edge)
  const axis = (pos: number, length: number, limit: number, dir: Direction) =>
    length <= limit ? { pos, length } : { pos: dir === -1 ? pos + length - limit : pos, length: limit }
  const ax = axis(base.x, base.w, cap.width, dirs.x)
  const ay = axis(base.y, base.h, cap.height, dirs.y)
  return rect(ax.pos, ay.pos, ax.length, ay.length)
}

/** Places `length` export px along an axis of `total`. */
function place(total: number, length: number, dir: Direction) {
  if (dir === 1) return { start: total - length, frameStart: total - length, frameLength: length + BLEED_OVERSHOOT }
  if (dir === -1) return { start: 0, frameStart: -BLEED_OVERSHOOT, frameLength: length + BLEED_OVERSHOOT }
  const start = Math.round((total - length) / 2)
  return { start, frameStart: start, frameLength: length }
}

export function computeLayout(
  image: Size,
  crop: Rect | null,
  capturedAt: number,
  zoom: number,
  edgeSetting: Edge | null,
  style: HouseStyle
): Layout {
  const scale = scaleFor(capturedAt, zoom, style)
  const edge = resolveEdge(edgeSetting, crop, image, scale, style)
  const sel = effectiveSelection(crop, image, capacity(scale, style, edge), edge)
  const dirs = edgeDirections(edge)
  const px = place(OUTPUT.width, sel.w * scale, dirs.x)
  const py = place(OUTPUT.height, sel.h * scale, dirs.y)
  return {
    scale,
    image,
    edge,
    sel,
    content: rect(px.start, py.start, sel.w * scale, sel.h * scale),
    frame: rect(px.frameStart, py.frameStart, px.frameLength, py.frameLength)
  }
}

export function sourceToOutput(layout: Layout, p: Point): Point {
  return {
    x: layout.content.x + (p.x - layout.sel.x) * layout.scale,
    y: layout.content.y + (p.y - layout.sel.y) * layout.scale
  }
}

export function outputToSource(layout: Layout, p: Point): Point {
  return {
    x: layout.sel.x + (p.x - layout.content.x) / layout.scale,
    y: layout.sel.y + (p.y - layout.content.y) / layout.scale
  }
}

export function sourceRectToOutput(layout: Layout, r: Rect): Rect {
  const a = sourceToOutput(layout, { x: r.x, y: r.y })
  return rect(a.x, a.y, r.w * layout.scale, r.h * layout.scale)
}

export function outputRectToSource(layout: Layout, r: Rect): Rect {
  const a = outputToSource(layout, { x: r.x, y: r.y })
  return rect(a.x, a.y, r.w / layout.scale, r.h / layout.scale)
}

/** The part of the screenshot that ends up in the image (source px). */
export function visibleSource(layout: Layout): Rect {
  return layout.sel
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

/** Crop mode: moves the selection by (dx, dy) source px without changing its size. */
export function moveSelection(sel: Rect, image: Size, dx: number, dy: number): Rect {
  return rect(clamp(sel.x + dx, 0, image.width - sel.w), clamp(sel.y + dy, 0, image.height - sel.h), sel.w, sel.h)
}

/** Keeps a selection inside the image and within what fits, holding the given sides in place. */
export function limitSelection(r: Rect, image: Size, cap: Size, keep: { right: boolean; bottom: boolean }): Rect {
  let next = clipTo(normalize(r), full(image))
  if (next.w > cap.width) next = { ...next, x: keep.right ? next.x + next.w - cap.width : next.x, w: cap.width }
  if (next.h > cap.height) next = { ...next, y: keep.bottom ? next.y + next.h - cap.height : next.y, h: cap.height }
  return next
}

/** Handle drag on the selection (start = the effective selection when the drag began). */
export function resizeSelection(start: Rect, handle: Handle, dx: number, dy: number, image: Size, cap: Size, min: number): Rect {
  const resized = resizeRect(start, handle, dx, dy, min)
  // Dragging the left / top edge keeps the right / bottom edge where it was.
  return limitSelection(resized, image, cap, { right: handle.includes('w'), bottom: handle.includes('n') })
}

/** A selection drawn from `a` to `b`, anchored at `a`. */
export function drawnSelection(a: Point, b: Point, image: Size, cap: Size): Rect {
  return limitSelection(rect(a.x, a.y, b.x - a.x, b.y - a.y), image, cap, { right: b.x < a.x, bottom: b.y < a.y })
}

/**
 * A selection that fills what fits on an axis the frame comes in from is kept open to the image
 * edge on that side. A smaller UI zoom then shows more of the screenshot, still running off the
 * edge, instead of the same part shrinking into the middle. Axes that stay inside are literal.
 */
export function openSelection(r: Rect, image: Size, cap: Size, edge: Edge | null): Rect {
  // Automatic edges come in from the right / bottom whenever the selection needs it.
  const dirs = edge ? edgeDirections(edge) : { x: 1 as Direction, y: 1 as Direction }
  let { x, y, w, h } = r
  if (dirs.x !== 0 && w >= cap.width - 0.5) {
    if (dirs.x === 1) w = image.width - x
    else {
      w = x + w
      x = 0
    }
  }
  if (dirs.y !== 0 && h >= cap.height - 0.5) {
    if (dirs.y === 1) h = image.height - y
    else {
      h = y + h
      y = 0
    }
  }
  return rect(x, y, w, h)
}

/** Rounds to whole pixels and drops a selection that is just the whole image. */
export function settleSelection(r: Rect, image: Size): Rect | null {
  const x = Math.round(r.x)
  const y = Math.round(r.y)
  const settled = rect(x, y, Math.round(r.x + r.w) - x, Math.round(r.y + r.h) - y)
  return settled.x <= 0 && settled.y <= 0 && settled.w >= image.width && settled.h >= image.height ? null : settled
}

/** Default box for a new redaction / spotlight: centered in what's visible. */
export function centeredBox(layout: Layout, widthShare: number, heightShare: number): Rect {
  const v = visibleSource(layout)
  const w = Math.max(16, v.w * widthShare)
  const h = Math.max(12, v.h * heightShare)
  return rect(Math.round(v.x + (v.w - w) / 2), Math.round(v.y + (v.h - h) / 2), Math.round(w), Math.round(h))
}
