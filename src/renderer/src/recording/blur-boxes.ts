import type { RedactStyle, Redaction } from '../app/doc'
import type { HouseStyle } from '../app/house-style'
import { drawRedaction } from '../render/compose'
import type { Size } from '../render/geometry'
import { recordingEditLayout } from './edit-layout'
import type { Span } from './timemap'
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

export const snapDownToFrame = (ms: number, fps: number): number => (Math.floor((ms * fps) / MS_PER_SECOND + GRID_TOLERANCE) * MS_PER_SECOND) / fps
export const snapUpToFrame = (ms: number, fps: number): number => (Math.ceil((ms * fps) / MS_PER_SECOND - GRID_TOLERANCE) * MS_PER_SECOND) / fps

/** A frame is only half unblurred if a box starts or ends inside it, so both ends go out to whole source frames. */
export function newBoxTime(playheadMs: number, trim: Trim, fps: number): Span {
  const end = snapUpToFrame(trim.end, fps)
  const start = Math.max(0, snapDownToFrame(Math.min(playheadMs, end - MIN_BOX_MS), fps))
  return { start, end }
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
