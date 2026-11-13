import type { RedactStyle, Redaction } from '../app/doc'
import type { HouseStyle } from '../app/house-style'
import { drawRedaction } from '../render/compose'
import { inverse, transformPoint, type Matrix, type Point, type Size } from '../render/geometry'
import { cameraAt, viewMatrix } from './camera'
import { recordingEditLayout } from './edit-layout'
import { recordingLayout } from './layout'
import { moveSpan, stretchSpan } from '../timeline/scale'
import { snapToOutput, type Span } from './timemap'
import type { TakeView } from './take-view'
import type { Trim } from './trim'

export const REDACTION_PAD_MS = 8
export const MIN_BOX_MS = 200

const MS_PER_SECOND = 1000
const GRID_TOLERANCE = 1e-9

export function isShownAt(redaction: Redaction, sourceMs: number): boolean {
  const { time } = redaction
  return time === null || (sourceMs >= time.start - REDACTION_PAD_MS && sourceMs <= time.end + REDACTION_PAD_MS)
}

/** What the canvas offers to edit at the playhead: the boxes on screen, and the selected ones wherever they are. */
export function boxesShownAt(redactions: Redaction[], sourceMs: number, selected: ReadonlySet<string>): Redaction[] {
  return redactions.filter((redaction) => selected.has(redaction.id) || isShownAt(redaction, sourceMs))
}

/** What the camera does to the wide frame (output px) at the playhead: the canvas shows it that way while it isn't wide. */
export function cameraViewMatrix(view: Pick<TakeView, 'camera' | 'frame' | 'map'>, output: Size, style: HouseStyle, sourceMs: number): Matrix {
  return viewMatrix(cameraAt(view.camera, snapToOutput(view.map, sourceMs)), recordingLayout(view.frame, output, style), output)
}

/** A point on the canvas (output px) as it sits in the wide frame, where boxes are edited: undoes the camera when the canvas isn't wide. */
export function wideViewPoint(
  point: Point,
  wide: boolean,
  view: Pick<TakeView, 'camera' | 'frame' | 'map'>,
  output: Size,
  style: HouseStyle,
  sourceMs: number
): Point {
  return wide ? point : transformPoint(inverse(cameraViewMatrix(view, output, style, sourceMs)), point)
}

export const snapDownToFrame = (ms: number, fps: number): number => (Math.floor((ms * fps) / MS_PER_SECOND + GRID_TOLERANCE) * MS_PER_SECOND) / fps
export const snapUpToFrame = (ms: number, fps: number): number => (Math.ceil((ms * fps) / MS_PER_SECOND - GRID_TOLERANCE) * MS_PER_SECOND) / fps

/** A frame is only half unblurred if a box starts or ends inside it, so both ends go out to whole source frames. */
export function newBoxTime(playheadMs: number, trim: Trim, fps: number, durationMs: number): Span {
  const bounds = boxBounds(trim, fps, durationMs)
  const start = Math.max(bounds.start, snapDownToFrame(Math.min(playheadMs, bounds.end - MIN_BOX_MS), fps))
  return { start, end: bounds.end }
}

/** Where a box may sit: the frames that hold the trim's start and end, never past the take. Clamping to these keeps every box edge on the grid. */
function boxBounds(trim: Trim, fps: number, durationMs: number): Span {
  const start = snapDownToFrame(trim.start, fps)
  return { start, end: Math.min(Math.max(snapUpToFrame(trim.end, fps), start + MS_PER_SECOND / fps), durationMs) }
}

/**
 * A loaded box covers whole frames: its start snaps down and its end up, inside the take, and it lasts a frame at least. A box the trim
 * left out stays where it was, as it does in the editor.
 */
export function settledBoxTime(time: Span, fps: number, durationMs: number): Span {
  const bounds = boxBounds({ start: 0, end: durationMs }, fps, durationMs)
  const start = Math.min(Math.max(snapDownToFrame(time.start, fps), bounds.start), bounds.end - MS_PER_SECOND / fps)
  return { start, end: Math.min(Math.max(snapUpToFrame(time.end, fps), snapUpToFrame(start + MS_PER_SECOND / fps, fps)), bounds.end) }
}

export function movedBoxTime(time: Span, start: number, trim: Trim, fps: number, durationMs: number): Span {
  const bounds = boxBounds(trim, fps, durationMs)
  const moved = moveSpan(time, snapDownToFrame(start, fps), bounds)
  const movedStart = snapDownToFrame(moved.start, fps)
  return { start: movedStart, end: Math.min(snapUpToFrame(movedStart + (time.end - time.start), fps), bounds.end) }
}

export function stretchedBoxTime(time: Span, edge: 'start' | 'end', at: number, trim: Trim, fps: number, durationMs: number): Span {
  const bounds = boxBounds(trim, fps, durationMs)
  const stretched = stretchSpan(time, edge, at, bounds, MIN_BOX_MS)
  return { start: snapDownToFrame(stretched.start, fps), end: Math.min(snapUpToFrame(stretched.end, fps), bounds.end) }
}

interface BoxScene {
  video: CanvasImageSource
  videoSize: Size
  view: Pick<TakeView, 'crop' | 'frame'>
  doc: { size: Size; redactions: Redaction[]; redactStyle: RedactStyle }
  style: HouseStyle
}

/** Into the picture, so they move and blur with it. Call inside the content clip. */
export function drawBlurBoxes(ctx: CanvasRenderingContext2D, scene: BoxScene, sourceMs: number): void {
  const { redactions, redactStyle } = scene.doc
  let layout: ReturnType<typeof recordingEditLayout> | null = null
  for (const redaction of redactions) {
    if (!isShownAt(redaction, sourceMs)) continue
    layout ??= recordingEditLayout(scene.view, scene.videoSize, scene.doc.size, scene.style)
    drawRedaction(ctx, { image: scene.video, ...scene.videoSize }, layout, redaction.rect, redactStyle)
  }
}
