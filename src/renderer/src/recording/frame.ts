import type { Doc } from '../app/doc'
import type { HouseStyle } from '../app/house-style'
import { drawBackground, drawBorder, drawFrameShadow, drawFrameUnderside, roundRectPath } from '../render/compose'
import { clamp, compose, inverse, transformPoint, translation, type Matrix, type Point, type Rect, type Size } from '../render/geometry'
import { CURSOR_BASE_PX, cursorBounds, drawCursor } from './cursor-art'
import { tiltAt, type CursorFrame } from './cursor'
import { activeClicks, drawClickEffect, pressScale } from './effects'
import { toComposition, type RecordingLayout } from './layout'
import type { RecordingDoc } from './settings'
import { sampleFrame, type CameraSamples, type CursorSamples, type FrameQuality } from './shutter'
import { stageFor } from './stage-cache'
import type { TakeView } from './take-view'

export interface RecordingScene {
  video: CanvasImageSource
  videoSize: Size
  view: TakeView
  doc: Doc
  settings: RecordingDoc
  style: HouseStyle
  backdrop: ImageBitmap | null
  /** The whole frame, with the camera left out, while the editor aims a zoom or a blur box on it. */
  wide: boolean
}

const CLICK_EFFECT_RADIUS_PX = 28
const OPAQUE_BASE = '#000'
const FULL_WEIGHT = 255
/** Room past the farthest a copy moves, for the smoothing at a layer’s edge. */
const LAYER_EDGE_PX = 2
/** Layers only grow, in these steps, so a moving camera or cursor never reallocates one frame after frame. */
const LAYER_STEP_PX = 16

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
interface Layer { canvas: OffscreenCanvas; ctx: Ctx }
type LayerRole = 'picture' | 'sprite' | 'stamps'
interface Sprite { canvas: OffscreenCanvas; width: number; height: number; hotspot: Point; origin: Point }

const roundUp = (value: number, step: number) => Math.ceil(value / step) * step
const frameRadius = (style: HouseStyle, content: Rect) => Math.min(style.radius, content.w / 2, content.h / 2)

/** Whole 255ths, spread evenly. globalAlpha weighs in 8 bits, and k/255 is exact there, so n copies add up to exactly one. */
export function stampWeights(count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.floor((FULL_WEIGHT * (i + 1)) / count) - Math.floor((FULL_WEIGHT * i) / count))
}

const layers = new WeakMap<Ctx, Map<LayerRole, Layer>>()

/**
 * Float16, so the copies add up without rounding each to 8 bits. A browser without it ignores or refuses the request, and its
 * 8-bit layer, with the same whole-255th weights, still keeps opaque pixels exact.
 */
function stampsContext(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D | null {
  return canvas.getContext('2d', { colorType: 'float16' }) ?? canvas.getContext('2d')
}

/** Each target keeps one layer per role that only grows; every draw clears and copies just the top-left part it uses. */
function layerFor(target: Ctx, role: LayerRole, width: number, height: number): Layer {
  let owned = layers.get(target)
  if (!owned) layers.set(target, (owned = new Map()))
  const layer = owned.get(role)
  if (layer) {
    if (layer.canvas.width < width) layer.canvas.width = width
    if (layer.canvas.height < height) layer.canvas.height = height
    return layer
  }
  const canvas = new OffscreenCanvas(width, height)
  const ctx = role === 'stamps' ? stampsContext(canvas) : canvas.getContext('2d')
  if (!ctx) throw new Error('The browser could not create a canvas for the motion blur.')
  const created = { canvas, ctx }
  owned.set(role, created)
  return created
}

/**
 * The background, the frame with its shadow, the video, the border and the click effects, over an opaque base. With a
 * stage, the shadow comes from it.
 */
function drawPicture(target: Ctx, scene: RecordingScene, layout: RecordingLayout, t: number, matrix: Matrix, base: Size, stage: OffscreenCanvas | null): void {
  const { video, view, doc, settings, style, backdrop } = scene
  const { crop, frame, track, effectClicks } = view
  const { content } = layout
  const ctx = target as CanvasRenderingContext2D
  const canvasPxPerPx = matrix[0]
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = OPAQUE_BASE
  ctx.fillRect(0, 0, base.width, base.height)
  ctx.setTransform(...matrix)

  drawBackground(ctx, doc, style, backdrop)
  const radius = frameRadius(style, content)
  if (stage) {
    ctx.drawImage(stage, 0, 0)
    drawFrameUnderside(ctx, content, radius, style)
  } else {
    drawFrameShadow(ctx, content, radius, style, canvasPxPerPx)
  }

  ctx.save()
  roundRectPath(ctx, content, radius)
  ctx.clip()
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, content.x, content.y, content.w, content.h)
  ctx.restore()
  drawBorder(ctx, content, radius, style)

  if (settings.clickEffect === 'off') return
  const radiusPx = CLICK_EFFECT_RADIUS_PX * layout.scale * track.scale
  for (const click of activeClicks(effectClicks, t, settings.clickEffect, frame)) {
    drawClickEffect(ctx, { ...click, ...toComposition(layout, click) }, settings.clickEffect, style.accent, radiusPx)
  }
}

/**
 * Within a frame the picture is the same image seen through slightly different views, so it is drawn once, at the frame’s
 * time, into a layer with room around it. Each sample is that layer moved as the camera moves the picture by then, and
 * blending the copies at 1/(i+1) over an opaque base keeps their running mean.
 */
function drawReprojected(
  target: Ctx,
  scene: RecordingScene,
  layout: RecordingLayout,
  t: number,
  atFrameTime: Matrix,
  camera: CameraSamples,
  stage: OffscreenCanvas | null
): void {
  const { width, height } = target.canvas
  const margin = Math.ceil(camera.travelPx) + LAYER_EDGE_PX
  const used = { width: width + 2 * margin, height: height + 2 * margin }
  const picture = layerFor(target, 'picture', roundUp(used.width, LAYER_STEP_PX), roundUp(used.height, LAYER_STEP_PX))
  picture.ctx.save()
  picture.ctx.setTransform(1, 0, 0, 1, 0, 0)
  picture.ctx.beginPath()
  picture.ctx.rect(0, 0, used.width, used.height)
  picture.ctx.clip()
  drawPicture(picture.ctx, scene, layout, t, compose(translation(margin, margin), atFrameTime), used, stage)
  picture.ctx.restore()

  const backToComposition = inverse(atFrameTime)
  target.setTransform(1, 0, 0, 1, 0, 0)
  target.fillStyle = OPAQUE_BASE
  target.fillRect(0, 0, width, height)
  camera.views.forEach((view, i) => {
    target.globalAlpha = 1 / (i + 1)
    target.setTransform(...compose(view, backToComposition))
    target.drawImage(picture.canvas, 0, 0, used.width, used.height, -margin, -margin, used.width, used.height)
  })
}

/**
 * The cursor as it looks at the frame’s time, drawn once at its size on the canvas. Its hotspot sits at the same fraction of
 * a px as on the canvas, so the sprite drawn at `origin` lands on whole px and is as sharp as the cursor drawn there.
 */
function cursorSprite(owner: Ctx, scene: RecordingScene, layout: RecordingLayout, t: number, atFrameTime: Matrix, frame: CursorFrame): Sprite {
  const { view, settings } = scene
  const canvasPxPerPx = atFrameTime[0]
  const position = toComposition(layout, frame)
  const onCanvas = transformPoint(atFrameTime, position)
  const heightPx = CURSOR_BASE_PX * settings.cursorSize * layout.scale * view.track.scale
  const press = pressScale(view.effectClicks, t)
  const tilt = settings.tilt ? tiltAt(view.cursor, t, view.track.scale) : 0
  const bounds = cursorBounds(frame.shape, heightPx * press * canvasPxPerPx, tilt)
  const origin = { x: Math.floor(onCanvas.x) + Math.floor(bounds.x), y: Math.floor(onCanvas.y) + Math.floor(bounds.y) }
  const hotspot = { x: onCanvas.x - origin.x, y: onCanvas.y - origin.y }
  const width = Math.ceil(hotspot.x + bounds.x + bounds.w)
  const height = Math.ceil(hotspot.y + bounds.y + bounds.h)
  const sprite = layerFor(owner, 'sprite', roundUp(width, LAYER_STEP_PX), roundUp(height, LAYER_STEP_PX))
  const ctx = sprite.ctx as CanvasRenderingContext2D
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.setTransform(canvasPxPerPx, 0, 0, canvasPxPerPx, hotspot.x - canvasPxPerPx * position.x, hotspot.y - canvasPxPerPx * position.y)
  drawCursor(ctx, { ...frame, ...position, opacity: 1 }, settings.look, heightPx, press, tilt)
  return { canvas: sprite.canvas, width, height, hotspot, origin }
}

function drawCursorStamps(target: Ctx, scene: RecordingScene, layout: RecordingLayout, t: number, atFrameTime: Matrix, cursor: CursorSamples): void {
  const sprite = cursorSprite(target, scene, layout, t, atFrameTime, cursor.frame)
  target.setTransform(1, 0, 0, 1, 0, 0)
  target.globalAlpha = cursor.frame.opacity
  if (cursor.hotspots.length === 1) {
    target.drawImage(sprite.canvas, 0, 0, sprite.width, sprite.height, sprite.origin.x, sprite.origin.y, sprite.width, sprite.height)
    return
  }
  const corners = cursor.hotspots.map(({ x, y }) => ({ x: x - sprite.hotspot.x, y: y - sprite.hotspot.y }))
  const { width, height } = target.canvas
  const left = clamp(Math.floor(Math.min(...corners.map((corner) => corner.x))), 0, width)
  const top = clamp(Math.floor(Math.min(...corners.map((corner) => corner.y))), 0, height)
  const right = clamp(Math.ceil(Math.max(...corners.map((corner) => corner.x)) + sprite.width), 0, width)
  const bottom = clamp(Math.ceil(Math.max(...corners.map((corner) => corner.y)) + sprite.height), 0, height)
  if (right <= left || bottom <= top) return
  const used = { width: right - left, height: bottom - top }
  const stamps = layerFor(target, 'stamps', Math.min(roundUp(used.width, LAYER_STEP_PX), width), Math.min(roundUp(used.height, LAYER_STEP_PX), height))
  const { ctx } = stamps
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, used.width, used.height)
  ctx.globalCompositeOperation = 'lighter'
  stampWeights(corners.length).forEach((weight, i) => {
    ctx.globalAlpha = weight / FULL_WEIGHT
    ctx.drawImage(sprite.canvas, 0, 0, sprite.width, sprite.height, corners[i].x - left, corners[i].y - top, sprite.width, sprite.height)
  })
  target.drawImage(stamps.canvas, 0, 0, used.width, used.height, left, top, used.width, used.height)
}

/**
 * Only the export keeps a stage: it draws every frame at one canvas px per output px, while the preview’s scale changes
 * with the view.
 */
function stageOf(owner: Ctx, scene: RecordingScene, layout: RecordingLayout, quality: FrameQuality, k: number): OffscreenCanvas | null {
  const { doc, style } = scene
  if (quality !== 'export' || k !== 1 || style.shadow <= 0) return null
  return stageFor(owner, doc.size, layout.content, frameRadius(style, layout.content), style)
}

/**
 * Nothing blurs at rest. The picture blurs by how far the camera moves it on the canvas, and the cursor by how far it moves
 * on the canvas, camera included; each layer blends just enough samples.
 */
export function drawRecordingFrame(ctx: Ctx, scene: RecordingScene, outputMs: number, quality: FrameQuality, k = 1): void {
  const { layout, view, camera, cursor } = sampleFrame(scene, outputMs, quality, k)
  const stage = stageOf(ctx, scene, layout, quality, k)
  ctx.save()
  ctx.globalAlpha = 1
  if (camera.views.length === 1) drawPicture(ctx, scene, layout, outputMs, view, ctx.canvas, stage)
  else drawReprojected(ctx, scene, layout, outputMs, view, camera, stage)
  if (cursor) drawCursorStamps(ctx, scene, layout, outputMs, view, cursor)
  ctx.restore()
}
