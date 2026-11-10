export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

export const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.w, b.x + b.w)
  const bottom = Math.min(a.y + a.h, b.y + b.h)
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null
}

/** Normalizes a rect drawn in any direction (negative width/height). */
export function normalize(r: Rect): Rect {
  return {
    x: r.w < 0 ? r.x + r.w : r.x,
    y: r.h < 0 ? r.y + r.h : r.y,
    w: Math.abs(r.w),
    h: Math.abs(r.h)
  }
}

/** Keeps a rect inside bounds, preserving size when it fits (used for moves). */
export function confineMove(r: Rect, bounds: Rect): Rect {
  const w = Math.min(r.w, bounds.w)
  const h = Math.min(r.h, bounds.h)
  return {
    x: Math.min(Math.max(r.x, bounds.x), bounds.x + bounds.w - w),
    y: Math.min(Math.max(r.y, bounds.y), bounds.y + bounds.h - h),
    w,
    h
  }
}

/** Clips a rect to bounds (used for resizes and draws). */
export function clipTo(r: Rect, bounds: Rect): Rect {
  return intersect(normalize(r), bounds) ?? { x: bounds.x, y: bounds.y, w: 0, h: 0 }
}

export function roundRect(r: Rect): Rect {
  const x = Math.round(r.x)
  const y = Math.round(r.y)
  return { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y }
}

export function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

export function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

/** A 2D affine transform in canvas order: x′ = a·x + c·y + e, y′ = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number]

export const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y]

/** `outer` applied after `inner`. */
export function compose([a, b, c, d, e, f]: Matrix, [p, q, r, s, u, v]: Matrix): Matrix {
  return [a * p + c * q, b * p + d * q, a * r + c * s, b * r + d * s, a * u + c * v + e, b * u + d * v + f]
}

export function inverse([a, b, c, d, e, f]: Matrix): Matrix {
  const det = a * d - b * c
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

export function transformPoint([a, b, c, d, e, f]: Matrix, { x, y }: Point): Point {
  return { x: a * x + c * y + e, y: b * x + d * y + f }
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function handlePoint(r: Rect, handle: Handle): Point {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const x = handle.includes('w') ? r.x : handle.includes('e') ? r.x + r.w : cx
  const y = handle.includes('n') ? r.y : handle.includes('s') ? r.y + r.h : cy
  return { x, y }
}

/** Applies a handle drag (delta in the rect's own space) and keeps a minimum size. */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, min = 1): Rect {
  let { x, y, w, h } = start
  if (handle.includes('w')) {
    const nx = Math.min(x + dx, x + w - min)
    w = w + (x - nx)
    x = nx
  }
  if (handle.includes('e')) w = Math.max(min, w + dx)
  if (handle.includes('n')) {
    const ny = Math.min(y + dy, y + h - min)
    h = h + (y - ny)
    y = ny
  }
  if (handle.includes('s')) h = Math.max(min, h + dy)
  return { x, y, w, h }
}

export const HANDLE_CURSOR: Record<Handle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize'
}
