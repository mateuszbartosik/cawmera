import type { ClickEffect } from './effects'
import type { CursorLook } from './cursor-art'
import type { ZoomSpeed } from './camera'
import { wholeTake, type Piece } from './timemap'
import { autoTrim, type Trim } from './trim'
import type { Click, RecordingTrack } from './track'
import type { ZoomEdit } from './zoom-edits'
import type { Size } from '../render/geometry'

export type RecordingFps = 30 | 60

export interface RecordingDoc {
  trim: Trim
  pieces: Piece[]
  /** Null while the zooms are automatic. */
  zooms: ZoomEdit[] | null
  cursorSize: number
  smoothing: number
  look: CursorLook
  clickEffect: ClickEffect
  hideWhenStill: boolean
  tilt: boolean
  /** Shares of a frame the shutter stays open for, per layer. */
  cursorBlur: number
  cameraBlur: number
  zoomSpeed: ZoomSpeed
  fps: RecordingFps
}

export const DEFAULT_RECORDING: Omit<RecordingDoc, 'trim' | 'pieces' | 'zooms'> = {
  cursorSize: 1.5,
  smoothing: 0.6,
  look: 'light',
  clickEffect: 'ring',
  hideWhenStill: true,
  tilt: true,
  cursorBlur: 0.5,
  cameraBlur: 0.5,
  zoomSpeed: 'calm',
  fps: 60
}

export const RECORDING_SIZE: Size = { width: 1920, height: 1080 }

export function recordingDocFor(track: RecordingTrack, previous: RecordingDoc | null, stopClick: Click | null = null): RecordingDoc {
  return { ...(previous ?? DEFAULT_RECORDING), trim: autoTrim(track, stopClick), pieces: wholeTake(track.durationMs), zooms: null }
}

type DefaultKey = keyof typeof DEFAULT_RECORDING

export function defaultsFor(keys: readonly DefaultKey[]): Partial<RecordingDoc> {
  return Object.fromEntries(keys.map((key) => [key, DEFAULT_RECORDING[key]]))
}

export function differsFromDefault(doc: RecordingDoc, keys: readonly DefaultKey[]): boolean {
  return keys.some((key) => doc[key] !== DEFAULT_RECORDING[key])
}
