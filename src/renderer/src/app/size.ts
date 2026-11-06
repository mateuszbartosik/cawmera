import type { Size } from '../render/geometry'

export interface SizePreset {
  name: string
  /** The shape as people say it. */
  ratio: string
  width: number
  height: number
}

/** The default, link previews, slides and social posts. */
export const SIZE_PRESETS: SizePreset[] = [
  { name: 'Default 16:10', ratio: '16:10', width: 1600, height: 1000 },
  { name: 'Article (OG)', ratio: '1.91:1', width: 1200, height: 630 },
  { name: 'Wide 16:9', ratio: '16:9', width: 1920, height: 1080 },
  { name: 'Square', ratio: '1:1', width: 1080, height: 1080 },
  { name: 'Portrait 4:5', ratio: '4:5', width: 1080, height: 1350 }
]

export const DEFAULT_SIZE: Size = { width: SIZE_PRESETS[0].width, height: SIZE_PRESETS[0].height }

/** Limits for a typed width or height, export px. */
export const MIN_SIDE = 400
export const MAX_SIDE = 4000

export function clampSide(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(value)))
}

/** Video encoders need even sides. */
export const evenSize = ({ width, height }: Size): Size => ({ width: Math.round(width / 2) * 2, height: Math.round(height / 2) * 2 })

export function presetFor(size: Size): SizePreset | null {
  return SIZE_PRESETS.find((preset) => preset.width === size.width && preset.height === size.height) ?? null
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
const twoPlaces = (value: number) => String(Math.round(value * 100) / 100)

/** A preset's own name for its shape, small whole numbers ("3:2"), or the long side over the short one. */
export function ratioLabel(size: Size): string {
  const preset = presetFor(size)
  if (preset) return preset.ratio
  const divisor = gcd(size.width, size.height)
  const a = size.width / divisor
  const b = size.height / divisor
  if (a <= 32 && b <= 32) return `${a}:${b}`
  return size.width >= size.height ? `${twoPlaces(size.width / size.height)}:1` : `1:${twoPlaces(size.height / size.width)}`
}
