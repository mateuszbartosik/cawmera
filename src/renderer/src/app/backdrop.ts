import type { Size } from '../render/geometry'

/** A picked background image up to this is stored as it is; a heavier one is re-encoded, so the style file stays small. */
export const BACKDROP_MAX_BYTES = 2 * 1024 * 1024
export const BACKDROP_MAX_SIDE = 4000

export type BackdropPlan = { keep: true } | { keep: false; size: Size }

export function backdropPlan(bytes: number, size: Size): BackdropPlan {
  const longSide = Math.max(size.width, size.height)
  if (bytes <= BACKDROP_MAX_BYTES && longSide <= BACKDROP_MAX_SIDE) return { keep: true }
  const k = Math.min(1, BACKDROP_MAX_SIDE / longSide)
  return { keep: false, size: { width: Math.round(size.width * k), height: Math.round(size.height * k) } }
}

const KEEPABLE = /^image\/(png|jpeg|webp|gif|bmp)$/

/** A picked image as the data URL the house style stores, and its pixels. */
export async function readBackdrop(file: Blob): Promise<{ url: string; bitmap: ImageBitmap }> {
  const bitmap = await createImageBitmap(file)
  const plan = backdropPlan(KEEPABLE.test(file.type) ? file.size : Number.POSITIVE_INFINITY, bitmap)
  if (plan.keep) return { url: await dataUrl(file), bitmap }
  const canvas = document.createElement('canvas')
  canvas.width = plan.size.width
  canvas.height = plan.size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is unavailable')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, plan.size.width, plan.size.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92))
  if (!blob || blob.type !== 'image/webp') throw new Error('WebP encoding is not supported here')
  return { url: await dataUrl(blob), bitmap: await createImageBitmap(blob) }
}

export function decodeBackdrop(url: string): Promise<ImageBitmap> {
  const comma = url.indexOf(',')
  const type = url.slice(5, url.indexOf(';'))
  const bytes = Uint8Array.from(atob(url.slice(comma + 1)), (char) => char.charCodeAt(0))
  return createImageBitmap(new Blob([bytes], { type }))
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
