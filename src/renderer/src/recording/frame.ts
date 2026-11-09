import type { Doc } from '../app/doc'
import type { HouseStyle } from '../app/house-style'
import { drawBackground, drawBorder, drawFrameShadow, roundRectPath } from '../render/compose'
import { clamp, type Size } from '../render/geometry'
import { cameraAt, type CameraPath, type CameraState } from './camera'
import { CURSOR_BASE_PX, drawCursor } from './cursor-art'
import { cursorAt } from './cursor'
import { activeClicks, drawClickEffect, pressScale } from './effects'
import { recordingLayout, type RecordingLayout } from './layout'
import type { RecordingDoc } from './settings'
import type { TakeView } from './take-view'

export interface RecordingScene {
  video: CanvasImageSource
  videoSize: Size
  view: TakeView
  doc: Doc
  settings: RecordingDoc
  style: HouseStyle
  backdrop: ImageBitmap | null
}

export const BLUR_SAMPLES = { preview: 3, export: 8 }
export type Matrix = [number, number, number, number, number, number]

const CLICK_EFFECT_RADIUS_PX = 28
const OPAQUE_BASE = '#000'
/** A spring only nears its goal: a camera moving under about a quarter output pixel across the shutter draws as still. */
const STILL_CAMERA_MOVE = { logDepth: 2.5e-4, focusPx: 0.1 }

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function viewMatrix(camera: CameraState, layout: RecordingLayout, output: Size): Matrix {
  const s = camera.depth
  const focusX = layout.content.x + camera.focus.x * layout.scale
  const focusY = layout.content.y + camera.focus.y * layout.scale
  const px = clamp(focusX, output.width / (2 * s), output.width - output.width / (2 * s))
  const py = clamp(focusY, output.height / (2 * s), output.height - output.height / (2 * s))
  return [s, 0, 0, s, output.width / 2 - px * s, output.height / 2 - py * s]
}

export function shutterTimes(t: number, fps: number, blur: number, samples: number): number[] {
  if (blur <= 0 || samples <= 1) return [t]
  const halfShutter = (blur * 1000) / fps / 2
  return Array.from({ length: samples }, (_, i) => t - halfShutter + (2 * halfShutter * i) / (samples - 1))
}

function drawSample(target: Ctx, scene: RecordingScene, layout: RecordingLayout, ti: number, k: number): void {
  const { video, view, doc, settings, style, backdrop } = scene
  const { crop, frame, track, effectClicks } = view
  const { content } = layout
  const ctx = target as CanvasRenderingContext2D
  const [a, b, c, d, e, f] = viewMatrix(cameraAt(view.camera, ti), layout, doc.size)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = OPAQUE_BASE
  ctx.fillRect(0, 0, doc.size.width * k, doc.size.height * k)
  ctx.setTransform(a * k, b * k, c * k, d * k, e * k, f * k)

  drawBackground(ctx, doc, style, backdrop)
  const radius = Math.min(style.radius, content.w / 2, content.h / 2)
  drawFrameShadow(ctx, content, radius, style, k * a)

  ctx.save()
  roundRectPath(ctx, content, radius)
  ctx.clip()
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, content.x, content.y, content.w, content.h)
  ctx.restore()
  drawBorder(ctx, content, radius, style)

  const toComposition = (point: { x: number; y: number }) => ({
    x: content.x + point.x * layout.scale,
    y: content.y + point.y * layout.scale
  })
  const sizeScale = layout.scale * track.scale
  if (settings.clickEffect !== 'off') {
    for (const click of activeClicks(effectClicks, ti, settings.clickEffect, frame)) {
      const at = toComposition(click)
      drawClickEffect(ctx, { ...click, ...at }, settings.clickEffect, style.accent, CLICK_EFFECT_RADIUS_PX * sizeScale)
    }
  }
  const cursor = cursorAt(view.cursor, ti, settings.hideWhenStill, frame)
  if (cursor) {
    const heightPx = CURSOR_BASE_PX * settings.cursorSize * sizeScale
    drawCursor(ctx, { ...cursor, ...toComposition(cursor) }, settings.look, heightPx, pressScale(effectClicks, ti))
  }
}

function cameraStillBetween(camera: CameraPath, from: number, to: number): boolean {
  const before = cameraAt(camera, from)
  const after = cameraAt(camera, to)
  return Math.abs(Math.log(after.depth / before.depth)) <= STILL_CAMERA_MOVE.logDepth
    && Math.hypot(after.focus.x - before.focus.x, after.focus.y - before.focus.y) <= STILL_CAMERA_MOVE.focusPx
}

function lookOf(scene: RecordingScene, t: number) {
  const { view, settings } = scene
  return JSON.stringify([
    cursorAt(view.cursor, t, settings.hideWhenStill, view.frame),
    activeClicks(view.effectClicks, t, settings.clickEffect, view.frame),
    pressScale(view.effectClicks, t)
  ])
}

function sampleTimes(scene: RecordingScene, t: number, quality: 'preview' | 'export'): number[] {
  const { view, settings } = scene
  const times = shutterTimes(t, settings.fps, settings.motionBlur, BLUR_SAMPLES[quality])
  const first = times[0]
  const last = times[times.length - 1]
  const still = cameraStillBetween(view.camera, first, last) && lookOf(scene, first) === lookOf(scene, last)
  return still ? [t] : times
}

interface Layer { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D }

const layers = new WeakMap<object, Layer>()

function layerFor(target: Ctx): Layer {
  const { width, height } = target.canvas
  const existing = layers.get(target)
  if (existing && existing.canvas.width === width && existing.canvas.height === height) return existing
  const canvas = new OffscreenCanvas(width, height)
  const layer = { canvas, ctx: canvas.getContext('2d') as OffscreenCanvasRenderingContext2D }
  layers.set(target, layer)
  return layer
}

/**
 * With several samples, each is drawn opaquely onto a layer and blended onto the target once at
 * alpha 1/(i+1): that is the running mean. Drawing the elements straight onto the target would
 * blend each of them separately and leave earlier samples with too much weight.
 */
export function drawRecordingFrame(ctx: Ctx, scene: RecordingScene, outputMs: number, quality: 'preview' | 'export', k = 1): void {
  const layout = recordingLayout(scene.view.frame, scene.doc.size, scene.style)
  const times = sampleTimes(scene, outputMs, quality)
  ctx.save()
  if (times.length === 1) {
    ctx.globalAlpha = 1
    drawSample(ctx, scene, layout, times[0], k)
  } else {
    const layer = layerFor(ctx)
    times.forEach((ti, i) => {
      layer.ctx.save()
      drawSample(layer.ctx, scene, layout, ti, k)
      layer.ctx.restore()
      ctx.globalAlpha = 1 / (i + 1)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(layer.canvas, 0, 0)
    })
  }
  ctx.restore()
}
