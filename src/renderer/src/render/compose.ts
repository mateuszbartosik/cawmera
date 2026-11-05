import { FORMAT_LABEL, type Doc, type ExportFormat, type RedactStyle, type Spotlight } from '../app/doc'
import type { HouseStyle } from '../app/house-style'
import { intersect, rect, type Rect, type Size } from './geometry'
import { computeLayout, sourceRectToOutput, visibleSource, type Layout } from './layout'

export interface SourceImage {
  image: CanvasImageSource
  width: number
  height: number
}

export interface Scene {
  source: SourceImage | null
  doc: Doc
  style: HouseStyle
  /** The house background image, for shots set to Image. */
  backdrop?: ImageBitmap | null
}

type Ctx = CanvasRenderingContext2D

export function layoutFor(scene: Scene): Layout | null {
  const { source, doc, style } = scene
  return source ? computeLayout(source, doc.crop, doc.capturedAt, doc.zoom, doc.edge, style, doc.size) : null
}

/** Draws the whole composition. `k` = canvas px per export px (1 for export, smaller for previews). */
export function drawScene(ctx: Ctx, scene: Scene, k = 1): Layout | null {
  const { source, doc, style, backdrop } = scene
  ctx.save()
  ctx.setTransform(k, 0, 0, k, 0, 0)
  if (doc.fill === 'image' && backdrop) drawBackdrop(ctx, backdrop, doc.size)
  else drawPlate(ctx, style, doc.size, doc.angle, doc.lightColor ?? style.glow, doc.lightIntensity)

  const layout = layoutFor(scene)
  if (source && layout) {
    const { frame, content, sel } = layout
    const radius = Math.min(style.radius, frame.w / 2, frame.h / 2)

    // Shadow first, as a filled shape under the screenshot. Shadow lengths are device px, hence * k.
    if (style.shadow > 0) {
      ctx.save()
      ctx.shadowColor = `rgba(0, 0, 0, ${style.shadow})`
      ctx.shadowBlur = 80 * k
      ctx.shadowOffsetY = 28 * k
      ctx.fillStyle = '#05070d'
      roundRectPath(ctx, frame, radius)
      ctx.fill()
      ctx.restore()
    }

    ctx.save()
    roundRectPath(ctx, frame, radius)
    ctx.clip()
    const effective = layout.scale * k
    ctx.imageSmoothingEnabled = !(Number.isInteger(effective) && effective >= 1)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source.image, sel.x, sel.y, sel.w, sel.h, content.x, content.y, content.w, content.h)

    for (const redaction of doc.redactions) drawRedaction(ctx, source, layout, redaction.rect, doc.redactStyle)
    if (doc.spotlight.on && doc.spotlight.rect) drawSpotlight(ctx, layout, doc.spotlight, style)
    ctx.restore()

    drawBorder(ctx, frame, radius, style)
  }

  ctx.restore()
  return layout
}

// ---------------------------------------------------------------------------
// Plate. Colours and strength are house style; each shot only picks where the light comes from.

/**
 * Where the glow sits for a light direction (degrees clockwise from the top), as a share of the
 * output. The point travels a rounded rectangle just outside the edges, so corners stay corners.
 */
export function lightPoint(angle: number): [number, number] {
  const rad = (angle * Math.PI) / 180
  const sx = Math.sin(rad)
  const sy = -Math.cos(rad)
  const p = 3
  const norm = Math.pow(Math.pow(Math.abs(sx), p) + Math.pow(Math.abs(sy), p), 1 / p)
  return [0.5 + (sx / norm) * 0.54, 0.5 + (sy / norm) * 0.56]
}

export function drawPlate(ctx: Ctx, style: HouseStyle, size: Size, angle: number, color: string = style.glow, intensity = 1) {
  const { width: W, height: H } = size
  const longSide = Math.max(W, H)
  const shortSide = Math.min(W, H)
  const [lx, ly] = lightPoint(angle)
  const light = { x: lx * W, y: ly * H }
  const far = { x: W - light.x, y: H - light.y }

  const base = ctx.createLinearGradient(light.x, light.y, far.x, far.y)
  base.addColorStop(0, style.plateFrom)
  base.addColorStop(1, style.plateTo)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, W, H)

  const strength = Math.min(1, style.glowStrength * Math.max(0, intensity))
  if (strength > 0) {
    const glow = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, longSide * 0.62)
    glow.addColorStop(0, withAlpha(color, strength))
    glow.addColorStop(0.45, withAlpha(color, strength * 0.35))
    glow.addColorStop(1, withAlpha(color, 0))
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, W, H)
  }

  // Quiet vignette, pulled towards the light, so the far corner settles.
  const cx = W / 2 + (light.x - W / 2) * 0.3
  const cy = H / 2 + (light.y - H / 2) * 0.3
  const vignette = ctx.createRadialGradient(cx, cy, shortSide * 0.4, cx, cy, longSide * 0.85)
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.28)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, W, H)
}

/** Where a background picture goes so it fills the whole image: scaled to cover, centred. */
export function coverRect(picture: Size, output: Size): Rect {
  const k = Math.max(output.width / picture.width, output.height / picture.height)
  const w = picture.width * k
  const h = picture.height * k
  return rect((output.width - w) / 2, (output.height - h) / 2, w, h)
}

function drawBackdrop(ctx: Ctx, picture: ImageBitmap, size: Size) {
  const { x, y, w, h } = coverRect(picture, size)
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(picture, x, y, w, h)
  ctx.restore()
}

function drawBorder(ctx: Ctx, frame: Rect, radius: number, style: HouseStyle) {
  if (style.border <= 0) return
  const edge = ctx.createLinearGradient(0, frame.y, 0, frame.y + Math.min(frame.h, 640))
  edge.addColorStop(0, `rgba(255, 255, 255, ${Math.min(1, style.border * 1.7)})`)
  edge.addColorStop(1, `rgba(255, 255, 255, ${style.border * 0.55})`)
  ctx.save()
  ctx.lineWidth = 2
  ctx.strokeStyle = edge
  roundRectPath(ctx, rect(frame.x + 1, frame.y + 1, frame.w - 2, frame.h - 2), Math.max(0, radius - 1))
  ctx.stroke()
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Redaction. Each mode destroys the pixels, it doesn't just veil them: the region is first
// shrunk to a few samples, so no text survives into the export.

const REDACT_BLOCK: Record<RedactStyle, number> = { blur: 18, pixelate: 12, solid: 1 }

function drawRedaction(ctx: Ctx, source: SourceImage, layout: Layout, box: Rect, mode: RedactStyle) {
  const region = intersect(box, visibleSource(layout))
  if (!region || region.w < 1 || region.h < 1) return
  const dst = sourceRectToOutput(layout, region)

  ctx.save()
  roundRectPath(ctx, dst, Math.min(6, dst.w / 2, dst.h / 2))
  ctx.clip()
  if (mode === 'solid') {
    ctx.fillStyle = averageColor(source, region)
    ctx.fillRect(dst.x, dst.y, dst.w, dst.h)
  } else {
    const block = REDACT_BLOCK[mode]
    const tw = Math.max(1, Math.round(dst.w / block))
    const th = Math.max(1, Math.round(dst.h / block))
    const small = scratch(tw, th)
    small.ctx.imageSmoothingEnabled = true
    small.ctx.imageSmoothingQuality = 'high'
    small.ctx.clearRect(0, 0, tw, th)
    small.ctx.drawImage(source.image, region.x, region.y, region.w, region.h, 0, 0, tw, th)
    ctx.imageSmoothingEnabled = mode === 'blur'
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(small.canvas, 0, 0, tw, th, dst.x, dst.y, dst.w, dst.h)
  }
  ctx.restore()
}

function averageColor(source: SourceImage, region: Rect): string {
  const one = scratch(1, 1)
  one.ctx.imageSmoothingEnabled = true
  one.ctx.imageSmoothingQuality = 'high'
  one.ctx.clearRect(0, 0, 1, 1)
  one.ctx.drawImage(source.image, region.x, region.y, region.w, region.h, 0, 0, 1, 1)
  const [r, g, b] = one.ctx.getImageData(0, 0, 1, 1).data
  return `rgb(${r}, ${g}, ${b})`
}

// ---------------------------------------------------------------------------
// Spotlight

function drawSpotlight(ctx: Ctx, layout: Layout, spot: Spotlight, style: HouseStyle) {
  if (!spot.rect) return
  const hole = sourceRectToOutput(layout, spot.rect)
  const radius = Math.min(12, hole.w / 2, hole.h / 2)
  const outer = layout.content
  ctx.save()
  ctx.beginPath()
  ctx.rect(outer.x - 4, outer.y - 4, outer.w + 8, outer.h + 8)
  roundRectSubpath(ctx, hole, radius)
  ctx.fillStyle = `rgba(3, 6, 15, ${spot.dim})`
  ctx.fill('evenodd')
  if (spot.outline) {
    ctx.beginPath()
    roundRectSubpath(ctx, rect(hole.x - 2, hole.y - 2, hole.w + 4, hole.h + 4), radius + 2)
    ctx.lineWidth = 3
    ctx.strokeStyle = style.accent
    ctx.stroke()
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Helpers

export function roundRectPath(ctx: Ctx, r: Rect, radius: number) {
  ctx.beginPath()
  roundRectSubpath(ctx, r, radius)
}

function roundRectSubpath(ctx: Ctx, r: Rect, radius: number) {
  const rr = Math.max(0, Math.min(radius, r.w / 2, r.h / 2))
  ctx.moveTo(r.x + rr, r.y)
  ctx.lineTo(r.x + r.w - rr, r.y)
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + rr, rr)
  ctx.lineTo(r.x + r.w, r.y + r.h - rr)
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x + r.w - rr, r.y + r.h, rr)
  ctx.lineTo(r.x + rr, r.y + r.h)
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y + r.h - rr, rr)
  ctx.lineTo(r.x, r.y + rr)
  ctx.arcTo(r.x, r.y, r.x + rr, r.y, rr)
  ctx.closePath()
}

function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha))})`
}

const scratchCache = new Map<string, { canvas: HTMLCanvasElement; ctx: Ctx }>()

function scratch(width: number, height: number) {
  const key = `${width}x${height}`
  let entry = scratchCache.get(key)
  if (!entry) {
    if (scratchCache.size > 24) scratchCache.clear()
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: width === 1 && height === 1 })
    if (!ctx) throw new Error('2D canvas is unavailable')
    entry = { canvas, ctx }
    scratchCache.set(key, entry)
  }
  return entry
}

const MIME: Record<ExportFormat, string> = { webp: 'image/webp', png: 'image/png' }

/**
 * Renders the image at its export size. WebP is lossless (quality 1 is lossless in Chromium), about half
 * the size of the PNG with identical pixels.
 */
export async function renderImage(scene: Scene, format: ExportFormat): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = scene.doc.size.width
  canvas.height = scene.doc.size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is unavailable')
  drawScene(ctx, scene, 1)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, MIME[format], 1))
  if (!blob || blob.type !== MIME[format]) throw new Error(`${FORMAT_LABEL[format]} encoding is not supported here`)
  return blob
}
