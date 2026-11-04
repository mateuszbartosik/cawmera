import type { Rect } from '../render/geometry'

/** Pixel density a screenshot was taken at (OS display scaling). */
export type Density = 1 | 1.25 | 1.5 | 2
export const DENSITIES: Density[] = [1, 1.25, 1.5, 2]

/** How large the captured UI appears in the image. 100% = one CSS px of the UI per CSS px of the image at its design width. */
export type UiZoom = 1 | 0.8 | 0.6
export const UI_ZOOMS: UiZoom[] = [1, 0.8, 0.6]

export type RedactStyle = 'blur' | 'pixelate' | 'solid'
export type ExportFormat = 'webp' | 'png'
export const FORMAT_LABEL: Record<ExportFormat, string> = { webp: 'WebP', png: 'PNG' }

/**
 * The edge the screenshot comes in from: it runs off that edge (or corner) of the image.
 * `c` keeps the whole frame inside, with the house inset on every side.
 */
export type Edge = 'tl' | 't' | 'tr' | 'l' | 'c' | 'r' | 'bl' | 'b' | 'br'
/** Reading order, as laid out in the 3 × 3 control. */
export const EDGES: Edge[] = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br']
export const EDGE_NAMES: Record<Edge, string> = {
  tl: 'Top left',
  t: 'Top',
  tr: 'Top right',
  l: 'Left',
  c: 'Inside',
  r: 'Right',
  bl: 'Bottom left',
  b: 'Bottom',
  br: 'Bottom right'
}

export type Direction = -1 | 0 | 1

/** Per axis: -1 runs off the start (left / top), 1 off the end (right / bottom), 0 stays inside. */
export function edgeDirections(edge: Edge): { x: Direction; y: Direction } {
  const x: Direction = edge.includes('l') ? -1 : edge.includes('r') ? 1 : 0
  const y: Direction = edge.startsWith('t') ? -1 : edge.startsWith('b') ? 1 : 0
  return { x, y }
}

export const isEdge = (value: unknown): value is Edge => typeof value === 'string' && (EDGES as string[]).includes(value)

export interface Redaction {
  id: string
  /** Source pixels, so a box stays on its text whatever the framing or zoom. */
  rect: Rect
}

export interface Spotlight {
  on: boolean
  rect: Rect | null
  dim: number
  outline: boolean
}

/** Everything that shapes one exported image. One snapshot = one undo step. */
export interface Doc {
  sourceId: string | null
  capturedAt: Density
  zoom: UiZoom
  /**
   * The part of the screenshot the frame shows (source px), null = the whole screenshot. Where it
   * fills the frame on a side it comes in from, it runs on to the image edge, so a smaller UI zoom
   * shows more.
   */
  crop: Rect | null
  /** The edge the screenshot comes in from; null = automatic (only where it doesn't fit inside). */
  edge: Edge | null
  redactions: Redaction[]
  redactStyle: RedactStyle
  spotlight: Spotlight
  /** Where the plate's light comes from: degrees clockwise from the top (315 = top left). */
  angle: number
  /** Light colour; null = the house colour. */
  lightColor: string | null
  /** Light intensity; 1 = the house strength. */
  lightIntensity: number
  fileName: string
}

export const DEFAULT_SPOTLIGHT: Spotlight = { on: false, rect: null, dim: 0.55, outline: true }

export const DEFAULT_DOC: Doc = {
  sourceId: null,
  capturedAt: 1,
  zoom: 1,
  crop: null,
  edge: null,
  redactions: [],
  redactStyle: 'blur',
  spotlight: DEFAULT_SPOTLIGHT,
  angle: 315,
  lightColor: null,
  lightIntensity: 1,
  fileName: ''
}

export function snapDensity(value: number): Density {
  if (!Number.isFinite(value) || value <= 0) return 1
  let best: Density = 1
  for (const d of DENSITIES) if (Math.abs(d - value) < Math.abs(best - value)) best = d
  return best
}

/** 0 ≤ angle < 360, whole degrees. */
export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return DEFAULT_DOC.angle
  return ((Math.round(angle) % 360) + 360) % 360
}

/** Shortest distance between two directions, in degrees. */
export function angleDistance(a: number, b: number): number {
  const d = Math.abs(normalizeAngle(a) - normalizeAngle(b)) % 360
  return d > 180 ? 360 - d : d
}

/** Consecutive shots are at least this far apart, so neighbouring images never look alike. */
export const MIN_ANGLE_APART = 60

/** A random light direction, at least MIN_ANGLE_APART away from `avoid`. */
export function randomAngle(avoid?: number, random: () => number = Math.random): number {
  if (avoid === undefined || !Number.isFinite(avoid)) return normalizeAngle(random() * 360)
  const span = 360 - 2 * MIN_ANGLE_APART
  return normalizeAngle(avoid + MIN_ANGLE_APART + Math.min(random(), 0.999999) * span)
}

const COMPASS = ['top', 'top right', 'right', 'bottom right', 'bottom', 'bottom left', 'left', 'top left']
/** "top left", "right" … for screen readers and tooltips. */
export function angleName(angle: number): string {
  return COMPASS[Math.round(normalizeAngle(angle) / 45) % 8]
}

/** `Settings Billing — Costs` → `settings-billing-costs`: lowercase words joined by hyphens. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.(png|webp)$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function exportFileName(name: string, format: ExportFormat = 'webp', fallback = 'whats-new-shot'): string {
  return `${slugify(name) || fallback}.${format}`
}
