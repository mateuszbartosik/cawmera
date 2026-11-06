import type { ClickEffect } from './effects'
import type { CursorLook } from './cursor-art'
import type { ZoomSpeed } from './camera'
import { autoTrim, type Trim } from './trim'
import type { RecordingTrack } from './track'
import type { Size } from '../render/geometry'

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

export const RECORDING_SIZE: Size = { width: 1920, height: 1080 }

export function recordingDocFor(track: RecordingTrack, previous: RecordingDoc | null): RecordingDoc {
  return { ...(previous ?? DEFAULT_RECORDING), trim: autoTrim(track) }
}
