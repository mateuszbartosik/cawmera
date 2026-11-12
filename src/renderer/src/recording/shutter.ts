import { compose, inverse, transformPoint, type Matrix, type Point, type Size } from '../render/geometry'
import { cameraAt, viewMatrix } from './camera'
import { cursorAt, cursorPositionAt, type CursorFrame } from './cursor'
import type { RecordingScene } from './frame'
import { recordingLayout, toComposition, type RecordingLayout } from './layout'
import type { Span, TimeMap } from './timemap'

export type FrameQuality = 'preview' | 'export'
export interface SampleCounts { camera: number; cursor: number }
export interface CameraSamples { views: Matrix[]; travelPx: number }
export interface CursorSamples { frame: CursorFrame; hotspots: Point[] }
/** In canvas px: the view at the frame’s time, the camera’s view at each of its samples, the cursor’s hotspot at each of its. */
export interface FrameSamples { layout: RecordingLayout; view: Matrix; camera: CameraSamples; cursor: CursorSamples | null }

export const BLUR_LIMITS: Record<FrameQuality, SampleCounts> = { preview: { camera: 24, cursor: 32 }, export: { camera: 32, cursor: 48 } }
/** Neighbouring samples sit at most this far apart on the target canvas, so no copy shows on its own. */
export const BLUR_STEP_PX = 2

/** Under half a px across the shutter, a quarter either side of the frame’s time, is rest. */
const STILL_TRAVEL_PX = 0.5
/** The cursor jumps at a cut’s seam, so a shutter that would reach one stops just short of it. */
const BEFORE_SEAM_MS = 1e-6
/** The cursor can turn within a shutter, so its travel follows its path through this many points between the ends. */
const PATH_POINTS_BETWEEN_ENDS = 4

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)
const pathLength = (points: Point[]) => points.slice(1).reduce((length, point, i) => length + distance(points[i], point), 0)
const layoutOf = (scene: RecordingScene): RecordingLayout => recordingLayout(scene.view.frame, scene.doc.size, scene.style)

function viewAt(scene: RecordingScene, layout: RecordingLayout, outputMs: number): Matrix {
  if (scene.wide) return [1, 0, 0, 1, 0, 0]
  return viewMatrix(cameraAt(scene.view.camera, outputMs), layout, scene.doc.size)
}

function canvasViewAt(scene: RecordingScene, layout: RecordingLayout, outputMs: number, k: number): Matrix {
  return viewAt(scene, layout, outputMs).map((value) => value * k) as Matrix
}

function hotspotOnCanvas(scene: RecordingScene, layout: RecordingLayout, outputMs: number, k: number): Point {
  return transformPoint(canvasViewAt(scene, layout, outputMs, k), toComposition(layout, cursorPositionAt(scene.view.cursor, outputMs)))
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

function seamsOf(map: TimeMap): number[] {
  return map.spans.filter((span, i) => i > 0 && span.source.start !== map.spans[i - 1].source.end).map((span) => span.outputStart)
}

function shutterOnOwnSide(t: number, fps: number, blur: number, seams: number[]): Span {
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

export function sampleFrame(scene: RecordingScene, t: number, quality: FrameQuality, k: number): FrameSamples {
  const { view, settings, doc } = scene
  const layout = layoutOf(scene)
  const limits = BLUR_LIMITS[quality]
  const seams = seamsOf(view.map)
  const frameView = canvasViewAt(scene, layout, t, k)

  const cameraSpan = shutterOnOwnSide(t, settings.fps, settings.cameraBlur, seams)
  const cameraTravel = cornerTravelPx(viewAt(scene, layout, cameraSpan.start), viewAt(scene, layout, cameraSpan.end), doc.size) * k
  const cameraTimes = timesAcross(cameraSpan, t, sampleCount(cameraTravel, limits.camera))
  const camera = { views: cameraTimes.map((time) => canvasViewAt(scene, layout, time, k)), travelPx: cameraTravel }

  const frame = cursorAt(view.cursor, t, settings.hideWhenStill, view.frame)
  if (!frame) return { layout, view: frameView, camera, cursor: null }
  const cursorSpan = shutterOnOwnSide(t, settings.fps, settings.cursorBlur, seams)
  const path = timesAcross(cursorSpan, t, PATH_POINTS_BETWEEN_ENDS + 2).map((time) => hotspotOnCanvas(scene, layout, time, k))
  const cursorTimes = timesAcross(cursorSpan, t, sampleCount(pathLength(path), limits.cursor))
  return { layout, view: frameView, camera, cursor: { frame, hotspots: cursorTimes.map((time) => hotspotOnCanvas(scene, layout, time, k)) } }
}

export function framePlan(scene: RecordingScene, outputMs: number, quality: FrameQuality, k = 1): SampleCounts {
  const { camera, cursor } = sampleFrame(scene, outputMs, quality, k)
  return { camera: camera.views.length, cursor: cursor?.hotspots.length ?? 1 }
}
