import type { Doc } from '../app/doc'
import type { HouseStyle } from '../app/house-style'
import { drawBackground, drawBorder, drawFrameShadow, roundRectPath } from '../render/compose'
import { clamp, type Point, type Size } from '../render/geometry'
import { cameraAt, type CameraState } from './camera'
import { CURSOR_BASE_PX, cursorBounds, drawCursor } from './cursor-art'
import { cursorAt, cursorPositionAt, tiltAt, type CursorFrame } from './cursor'
import { activeClicks, drawClickEffect, pressScale } from './effects'
import { recordingLayout, type RecordingLayout } from './layout'
import type { RecordingDoc } from './settings'
import type { TakeView } from './take-view'
import type { Span, TimeMap } from './timemap'

export interface RecordingScene {
  video: CanvasImageSource
  videoSize: Size
  view: TakeView
  doc: Doc
  settings: RecordingDoc
  style: HouseStyle
  backdrop: ImageBitmap | null
}

export type Matrix = [number, number, number, number, number, number]
export type FrameQuality = 'preview' | 'export'
export interface SampleCounts { camera: number; cursor: number }

export const BLUR_LIMITS: Record<FrameQuality, SampleCounts> = { preview: { camera: 24, cursor: 32 }, export: { camera: 32, cursor: 48 } }
/** Neighbouring samples sit at most this far apart on the target canvas, so no copy shows on its own. */
export const BLUR_STEP_PX = 2

/** Under half a px across the shutter, a quarter either side of the frame’s time, is rest. */
const STILL_TRAVEL_PX = 0.5
const CLICK_EFFECT_RADIUS_PX = 28
const OPAQUE_BASE = '#000'
/** Room past the farthest a copy moves, for the smoothing at a layer’s edge. */
const LAYER_EDGE_PX = 2
/** Layers are sized in steps, so a moving camera resizes its layer a few times per move rather than every frame. */
const LAYER_STEP_PX = 16
/** The cursor jumps at a cut’s seam, so a shutter that would reach one stops just short of it. */
const BEFORE_SEAM_MS = 1e-6

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

interface LayerPlan { times: number[]; travelPx: number }
interface CursorPlan extends LayerPlan { frame: CursorFrame }
interface Plan { layout: RecordingLayout; camera: LayerPlan; cursor: CursorPlan | null }

/** `outer` applied after `inner`. */
function compose([a, b, c, d, e, f]: Matrix, [p, q, r, s, u, v]: Matrix): Matrix {
  return [a * p + c * q, b * p + d * q, a * r + c * s, b * r + d * s, a * u + c * v + e, b * u + d * v + f]
}

function inverse([a, b, c, d, e, f]: Matrix): Matrix {
  const det = a * d - b * c
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

function transformPoint([a, b, c, d, e, f]: Matrix, { x, y }: Point): Point {
  return { x: a * x + c * y + e, y: b * x + d * y + f }
}

const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y]
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)
const roundUp = (value: number, step: number) => Math.ceil(value / step) * step
const toComposition = ({ content, scale }: RecordingLayout, point: Point): Point =>
  ({ x: content.x + point.x * scale, y: content.y + point.y * scale })

export function viewMatrix(camera: CameraState, layout: RecordingLayout, output: Size): Matrix {
  const s = camera.depth
  const focusX = layout.content.x + camera.focus.x * layout.scale
  const focusY = layout.content.y + camera.focus.y * layout.scale
  const px = clamp(focusX, output.width / (2 * s), output.width - output.width / (2 * s))
  const py = clamp(focusY, output.height / (2 * s), output.height - output.height / (2 * s))
  return [s, 0, 0, s, output.width / 2 - px * s, output.height / 2 - py * s]
}

const layoutOf = (scene: RecordingScene): RecordingLayout => recordingLayout(scene.view.frame, scene.doc.size, scene.style)

function viewAt(scene: RecordingScene, layout: RecordingLayout, outputMs: number): Matrix {
  return viewMatrix(cameraAt(scene.view.camera, outputMs), layout, scene.doc.size)
}

/** The view in canvas px, `k` of them per output px. */
function canvasViewAt(scene: RecordingScene, layout: RecordingLayout, outputMs: number, k: number): Matrix {
  return viewAt(scene, layout, outputMs).map((value) => value * k) as Matrix
}

export function cameraMatrixAt(scene: RecordingScene, outputMs: number): Matrix {
  return viewAt(scene, layoutOf(scene), outputMs)
}

/** The farthest any output corner moves on screen when the view changes from `a` to `b`. */
export function cornerTravelPx(a: Matrix, b: Matrix, output: Size): number {
  const move = compose(b, inverse(a))
  const corners = [{ x: 0, y: 0 }, { x: output.width, y: 0 }, { x: 0, y: output.height }, { x: output.width, y: output.height }]
  return Math.max(...corners.map((corner) => distance(corner, transformPoint(move, corner))))
}

export function shutterTimes(t: number, fps: number, blur: number, samples: number): number[] {
  if (blur <= 0 || samples <= 1) return [t]
  const halfShutter = (blur * 1000) / fps / 2
  return Array.from({ length: samples }, (_, i) => t + halfShutter * ((2 * i) / (samples - 1) - 1))
}

export function sampleCount(travelPx: number, cap: number): number {
  return travelPx < STILL_TRAVEL_PX ? 1 : Math.min(cap, Math.ceil(travelPx / BLUR_STEP_PX) + 1)
}

/** Output times where a cut joins two spans: the video and the cursor jump there. */
function seamsOf(map: TimeMap): number[] {
  return map.spans.filter((span, i) => i > 0 && span.source.start !== map.spans[i - 1].source.end).map((span) => span.outputStart)
}

/** The part of the shutter on the frame’s own side of every seam it would span. */
function shutterSpan(t: number, fps: number, blur: number, seams: number[]): Span {
  const ends = shutterTimes(t, fps, blur, 2)
  let start = ends[0]
  let end = ends[ends.length - 1]
  for (const seam of seams) {
    if (seam <= t) start = Math.max(start, seam)
    else end = Math.min(end, Math.max(t, seam - BEFORE_SEAM_MS))
  }
  return { start, end }
}

function timesAcross({ start, end }: Span, t: number, count: number): number[] {
  if (count === 1) return [t]
  return Array.from({ length: count }, (_, i) => start + ((end - start) * i) / (count - 1))
}

/** Where the cursor’s hotspot is on the canvas, camera included. */
function cursorOnCanvas(scene: RecordingScene, layout: RecordingLayout, outputMs: number, k: number): Point {
  return transformPoint(canvasViewAt(scene, layout, outputMs, k), toComposition(layout, cursorPositionAt(scene.view.cursor, outputMs)))
}

function planFrame(scene: RecordingScene, t: number, quality: FrameQuality, k: number): Plan {
  const { view, settings, doc } = scene
  const layout = layoutOf(scene)
  const limits = BLUR_LIMITS[quality]
  const seams = seamsOf(view.map)
  const layerPlan = (span: Span, travelPx: number, cap: number): LayerPlan => ({ times: timesAcross(span, t, sampleCount(travelPx, cap)), travelPx })

  const cameraSpan = shutterSpan(t, settings.fps, settings.cameraBlur, seams)
  const cameraTravel = cornerTravelPx(viewAt(scene, layout, cameraSpan.start), viewAt(scene, layout, cameraSpan.end), doc.size) * k
  const camera = layerPlan(cameraSpan, cameraTravel, limits.camera)

  const frame = cursorAt(view.cursor, t, settings.hideWhenStill, view.frame)
  if (!frame) return { layout, camera, cursor: null }
  const cursorSpan = shutterSpan(t, settings.fps, settings.cursorBlur, seams)
  const cursorTravel = distance(cursorOnCanvas(scene, layout, cursorSpan.start, k), cursorOnCanvas(scene, layout, cursorSpan.end, k))
  return { layout, camera, cursor: { ...layerPlan(cursorSpan, cursorTravel, limits.cursor), frame } }
}

/** How many samples each layer blends at this time: copies sit at most BLUR_STEP_PX apart on the canvas. */
export function framePlan(scene: RecordingScene, outputMs: number, quality: FrameQuality, k = 1): SampleCounts {
  const { camera, cursor } = planFrame(scene, outputMs, quality, k)
  return { camera: camera.times.length, cursor: cursor?.times.length ?? 1 }
}

interface Layer { canvas: OffscreenCanvas; ctx: Ctx }
type LayerRole = 'picture' | 'sprite' | 'stamps'

const layers = new WeakMap<Ctx, Map<LayerRole, Layer>>()

/** Each target keeps one layer per role. The picture layer is large, so it takes the size it needs; the cursor’s only grow. */
function layerFor(target: Ctx, role: LayerRole, width: number, height: number): Layer {
  let owned = layers.get(target)
  if (!owned) layers.set(target, (owned = new Map()))
  const layer = owned.get(role)
  if (layer) {
    const onlyGrows = role !== 'picture'
    const size = onlyGrows ? { width: Math.max(width, layer.canvas.width), height: Math.max(height, layer.canvas.height) } : { width, height }
    if (layer.canvas.width !== size.width) layer.canvas.width = size.width
    if (layer.canvas.height !== size.height) layer.canvas.height = size.height
    return layer
  }
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The browser could not create a canvas for the motion blur.')
  const created = { canvas, ctx }
  owned.set(role, created)
  return created
}

/** The background, the frame with its shadow, the video, the border and the click effects, over an opaque base. */
function drawPicture(target: Ctx, scene: RecordingScene, layout: RecordingLayout, t: number, matrix: Matrix, base: Size): void {
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
  const radius = Math.min(style.radius, content.w / 2, content.h / 2)
  drawFrameShadow(ctx, content, radius, style, canvasPxPerPx)

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
function drawReprojected(target: Ctx, scene: RecordingScene, layout: RecordingLayout, t: number, camera: LayerPlan, k: number): void {
  const { width, height } = target.canvas
  const margin = roundUp(Math.ceil(camera.travelPx) + LAYER_EDGE_PX, LAYER_STEP_PX)
  const picture = layerFor(target, 'picture', width + 2 * margin, height + 2 * margin)
  const atFrameTime = canvasViewAt(scene, layout, t, k)
  drawPicture(picture.ctx, scene, layout, t, compose(translation(margin, margin), atFrameTime), picture.canvas)

  const backToComposition = inverse(atFrameTime)
  target.setTransform(1, 0, 0, 1, 0, 0)
  target.fillStyle = OPAQUE_BASE
  target.fillRect(0, 0, width, height)
  camera.times.forEach((time, i) => {
    target.globalAlpha = 1 / (i + 1)
    target.setTransform(...compose(canvasViewAt(scene, layout, time, k), backToComposition))
    target.drawImage(picture.canvas, -margin, -margin)
  })
}

interface Sprite { canvas: OffscreenCanvas; hotspot: Point; origin: Point }

/**
 * The cursor as it looks at the frame’s time, drawn once at its size on the canvas. Its hotspot sits at the same fraction of
 * a px as on the canvas, so the sprite drawn at `origin` lands on whole px and is as sharp as the cursor drawn there.
 */
function cursorSprite(owner: Ctx, scene: RecordingScene, layout: RecordingLayout, t: number, frame: CursorFrame, k: number): Sprite {
  const { view, settings } = scene
  const atFrameTime = canvasViewAt(scene, layout, t, k)
  const canvasPxPerPx = atFrameTime[0]
  const position = toComposition(layout, frame)
  const onCanvas = transformPoint(atFrameTime, position)
  const heightPx = CURSOR_BASE_PX * settings.cursorSize * layout.scale * view.track.scale
  const press = pressScale(view.effectClicks, t)
  const tilt = settings.tilt ? tiltAt(view.cursor, t, view.track.scale) : 0
  const bounds = cursorBounds(frame.shape, heightPx * press * canvasPxPerPx, tilt)
  const origin = { x: Math.floor(onCanvas.x) + Math.floor(bounds.x), y: Math.floor(onCanvas.y) + Math.floor(bounds.y) }
  const hotspot = { x: onCanvas.x - origin.x, y: onCanvas.y - origin.y }
  const sprite = layerFor(owner, 'sprite', roundUp(hotspot.x + bounds.x + bounds.w, LAYER_STEP_PX), roundUp(hotspot.y + bounds.y + bounds.h, LAYER_STEP_PX))
  const ctx = sprite.ctx as CanvasRenderingContext2D
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, sprite.canvas.width, sprite.canvas.height)
  ctx.setTransform(canvasPxPerPx, 0, 0, canvasPxPerPx, hotspot.x - canvasPxPerPx * position.x, hotspot.y - canvasPxPerPx * position.y)
  drawCursor(ctx, { ...frame, ...position, opacity: 1 }, settings.look, heightPx, press, tilt)
  return { canvas: sprite.canvas, hotspot, origin }
}

/** One sprite, stamped where each sample has the cursor and added up at 1/n so the copies average, laid on the picture. */
function drawCursorStamps(target: Ctx, scene: RecordingScene, layout: RecordingLayout, t: number, cursor: CursorPlan, k: number): void {
  const sprite = cursorSprite(target, scene, layout, t, cursor.frame, k)
  target.setTransform(1, 0, 0, 1, 0, 0)
  target.globalAlpha = cursor.frame.opacity
  if (cursor.times.length === 1) {
    target.drawImage(sprite.canvas, sprite.origin.x, sprite.origin.y)
    return
  }
  const corners = cursor.times.map((time) => {
    const at = cursorOnCanvas(scene, layout, time, k)
    return { x: at.x - sprite.hotspot.x, y: at.y - sprite.hotspot.y }
  })
  const left = Math.floor(Math.min(...corners.map((corner) => corner.x)))
  const top = Math.floor(Math.min(...corners.map((corner) => corner.y)))
  const right = Math.max(...corners.map((corner) => corner.x)) + sprite.canvas.width
  const bottom = Math.max(...corners.map((corner) => corner.y)) + sprite.canvas.height
  const stamps = layerFor(target, 'stamps', roundUp(right - left, LAYER_STEP_PX), roundUp(bottom - top, LAYER_STEP_PX))
  const { ctx } = stamps
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, stamps.canvas.width, stamps.canvas.height)
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 1 / corners.length
  for (const corner of corners) ctx.drawImage(sprite.canvas, corner.x - left, corner.y - top)
  target.drawImage(stamps.canvas, left, top)
}

/**
 * Nothing blurs at rest. The picture (background, frame, video and click effects) blurs by how far the camera moves it on
 * the canvas, and the cursor by how far it moves on the canvas, camera included; each layer blends just enough samples.
 */
export function drawRecordingFrame(ctx: Ctx, scene: RecordingScene, outputMs: number, quality: FrameQuality, k = 1): void {
  const { layout, camera, cursor } = planFrame(scene, outputMs, quality, k)
  ctx.save()
  ctx.globalAlpha = 1
  if (camera.times.length === 1) drawPicture(ctx, scene, layout, outputMs, canvasViewAt(scene, layout, outputMs, k), ctx.canvas)
  else drawReprojected(ctx, scene, layout, outputMs, camera, k)
  if (cursor) drawCursorStamps(ctx, scene, layout, outputMs, cursor, k)
  ctx.restore()
}
