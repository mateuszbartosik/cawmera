import { useSyncExternalStore } from 'react'
import { store } from '../app/store'
import { normalize, type Point, type Rect, type Size } from '../render/geometry'

export const RECORDING_CROP_MIN_PX = 64

function clippedToWholePx(r: Rect, video: Size): Rect {
  const { x, y, w, h } = normalize(r)
  const left = Math.round(Math.min(Math.max(x, 0), video.width))
  const top = Math.round(Math.min(Math.max(y, 0), video.height))
  const right = Math.round(Math.min(Math.max(x + w, 0), video.width))
  const bottom = Math.round(Math.min(Math.max(y + h, 0), video.height))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

function atLeastMinimum(start: number, length: number, limit: number): { start: number; length: number } {
  const grown = Math.max(length, RECORDING_CROP_MIN_PX)
  return { start: Math.min(start, limit - grown), length: grown }
}

/** Clipped to the video, at least 64 px, in whole px; null when it is the whole video. */
export function settleRecordingCrop(r: Rect, video: Size): Rect | null {
  const clipped = clippedToWholePx(r, video)
  const horizontal = atLeastMinimum(clipped.x, clipped.w, video.width)
  const vertical = atLeastMinimum(clipped.y, clipped.h, video.height)
  const settled = { x: horizontal.start, y: vertical.start, w: horizontal.length, h: vertical.length }
  return settled.w === video.width && settled.h === video.height ? null : settled
}

export function drawnRecordingCrop(a: Point, b: Point, video: Size): Rect {
  return clippedToWholePx({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }, video)
}

/** A crop drawn smaller than this leaves the shot as it was. */
export const keepsDrawnCrop = (drawn: Rect): boolean => drawn.w >= RECORDING_CROP_MIN_PX && drawn.h >= RECORDING_CROP_MIN_PX

let cropFrame: ImageBitmap | null = null
const listeners = new Set<() => void>()

/** The frame crop mode shows. Closing is this module’s job: a replaced frame is closed here, and so is the one left when crop mode ends. */
export function setCropFrame(frame: ImageBitmap | null) {
  if (frame === cropFrame) return
  cropFrame?.close()
  cropFrame = frame
  for (const listener of listeners) listener()
}

export const currentCropFrame = () => cropFrame

export function useCropFrame(): ImageBitmap | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => cropFrame
  )
}

store.subscribe(() => {
  if (cropFrame && store.get().mode !== 'crop') setCropFrame(null)
})
