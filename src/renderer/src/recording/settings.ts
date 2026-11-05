import type { ClickEffect } from './effects'
import type { CursorLook } from './cursor-art'
import type { ZoomSpeed } from './camera'
import type { Trim } from './trim'

export type RecordingFps = 30 | 60

export interface RecordingDoc {
  trim: Trim
  cursorSize: number
  smoothing: number
  look: CursorLook
  clickEffect: ClickEffect
  hideWhenStill: boolean
  motionBlur: number
  zoomSpeed: ZoomSpeed
  fps: RecordingFps
}

export const DEFAULT_RECORDING: Omit<RecordingDoc, 'trim'> = {
  cursorSize: 1.5,
  smoothing: 0.6,
  look: 'light',
  clickEffect: 'ring',
  hideWhenStill: true,
  motionBlur: 0.5,
  zoomSpeed: 'calm',
  fps: 60
}
