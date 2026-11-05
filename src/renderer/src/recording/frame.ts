import type { Doc } from '../app/doc'
import type { HouseStyle } from '../app/house-style'
import { drawBackground, drawBorder, drawFrameShadow, roundRectPath } from '../render/compose'
import type { Size } from '../render/geometry'
import { cameraAt, type CameraState } from './camera'
import { CURSOR_BASE_PX, drawCursor } from './cursor-art'
import { cursorAt, type CursorPath } from './cursor'
import { activeClicks, drawClickEffect, pressScale } from './effects'
import { recordingLayout, type RecordingLayout } from './layout'
import type { RecordingDoc } from './settings'
import type { RecordingTrack } from './track'
import type { ZoomSegment } from './zooms'

export interface RecordingScene {
  video: CanvasImageSource
  videoSize: Size
  track: RecordingTrack
  zooms: ZoomSegment[]
  path: CursorPath
  doc: Doc
  settings: RecordingDoc
  style: HouseStyle
  backdrop: ImageBitmap | null
}

export const BLUR_SAMPLES = { preview: 3, export: 8 }
export type Matrix = [number, number, number, number, number, number]

const CLICK_EFFECT_RADIUS_PX = 28
const OPAQUE_BASE = '#000'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

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

function drawSample(ctx: Ctx, scene: RecordingScene, layout: RecordingLayout, ti: number, k: number): void {
  const { video, videoSize, track, zooms, path, doc, settings, style, backdrop } = scene
  const { content } = layout
  const canvas = ctx as CanvasRenderingContext2D
  const camera = cameraAt(ti, zooms, videoSize, settings.zoomSpeed)
  const [a, b, c, d, e, f] = viewMatrix(camera, layout, doc.size)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = OPAQUE_BASE
  ctx.fillRect(0, 0, doc.size.width * k, doc.size.height * k)
  ctx.setTransform(a * k, b * k, c * k, d * k, e * k, f * k)

  drawBackground(canvas, doc, style, backdrop)
  const radius = Math.min(style.radius, content.w / 2, content.h / 2)
  drawFrameShadow(canvas, content, radius, style, k)

  ctx.save()
  roundRectPath(canvas, content, radius)
  ctx.clip()
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(video, content.x, content.y, content.w, content.h)
  ctx.restore()
  drawBorder(canvas, content, radius, style)

  const toComposition = (point: { x: number; y: number }) => ({
    x: content.x + point.x * layout.scale,
    y: content.y + point.y * layout.scale
  })
  const sizeScale = layout.scale * track.scale
  if (settings.clickEffect !== 'off') {
    for (const click of activeClicks(track.clicks, ti, settings.clickEffect, videoSize)) {
      const at = toComposition(click)
      drawClickEffect(canvas, { ...click, ...at }, settings.clickEffect, style.accent, CLICK_EFFECT_RADIUS_PX * sizeScale)
    }
  }
  const cursor = cursorAt(path, ti, settings.hideWhenStill, videoSize)
  if (cursor) {
    const heightPx = CURSOR_BASE_PX * settings.cursorSize * sizeScale
    drawCursor(canvas, { ...cursor, ...toComposition(cursor) }, settings.look, heightPx, pressScale(track.clicks, ti))
  }
}

function lookOf(scene: RecordingScene, t: number) {
  const { videoSize, zooms, settings, track, path } = scene
  return JSON.stringify([
    cameraAt(t, zooms, videoSize, settings.zoomSpeed),
    cursorAt(path, t, settings.hideWhenStill, videoSize),
    activeClicks(track.clicks, t, settings.clickEffect, videoSize),
    pressScale(track.clicks, t)
  ])
}

function sampleTimes(scene: RecordingScene, t: number, quality: 'preview' | 'export'): number[] {
  const { settings } = scene
  const times = shutterTimes(t, settings.fps, settings.motionBlur, BLUR_SAMPLES[quality])
  const first = times[0]
  const last = times[times.length - 1]
  return lookOf(scene, first) === lookOf(scene, last) ? [t] : times
}

export function drawRecordingFrame(ctx: Ctx, scene: RecordingScene, t: number, quality: 'preview' | 'export', k = 1): void {
  const layout = recordingLayout(scene.videoSize, scene.doc.size, scene.style)
  ctx.save()
  sampleTimes(scene, t, quality).forEach((ti, i) => {
    ctx.save()
    // Each sample repaints the whole output opaquely at alpha 1/(i+1), which makes the canvas the mean of the samples so far.
    ctx.globalAlpha = 1 / (i + 1)
    drawSample(ctx, scene, layout, ti, k)
    ctx.restore()
  })
  ctx.restore()
}
