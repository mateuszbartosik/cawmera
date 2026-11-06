import type { RecordingFinished } from '@shared/types'
import type { Size } from '../render/geometry'

export const CURSOR_SHAPES = ['arrow', 'hand', 'ibeam', 'wait', 'progress', 'crosshair', 'not-allowed', 'move',
  'resize-ew', 'resize-ns', 'resize-nwse', 'resize-nesw', 'help', 'other'] as const
export type CursorShape = (typeof CURSOR_SHAPES)[number]
export interface CursorSample { t: number; x: number; y: number; shape: CursorShape | null }
export interface Click { t: number; x: number; y: number; button: 'left' | 'right'; up: number | null }
export interface RecordingTrack {
  kind: 'window' | 'monitor'; width: number; height: number; fps: number; durationMs: number; scale: number
  cursor: CursorSample[]; clicks: Click[]
}

const CURSOR_ROW_LENGTH = 4
const CLICK_ROW_LENGTH = 5
const HIDDEN_SHAPE_INDEX = -1
const NO_RELEASE = -1
const STOP_CLICK_WITHIN_MS = 700
const TASKBAR_ZONE_PX = 250

function invalidTrack(): never {
  throw new Error('Not a Cawmera recording track')
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

function rowsOf(value: unknown, length: number): unknown[][] {
  if (!Array.isArray(value)) return invalidTrack()
  for (const row of value) if (!Array.isArray(row) || row.length !== length) return invalidTrack()
  return value as unknown[][]
}

function isFiniteRow(row: unknown[]): row is number[] {
  return row.every((value) => typeof value === 'number' && Number.isFinite(value))
}

function shapeNamed(name: unknown): CursorShape {
  return (CURSOR_SHAPES as readonly unknown[]).includes(name) ? (name as CursorShape) : 'other'
}

/** Reads the helper's `track.json` (version 1) into a track with rows sorted by time. */
export function parseTrack(json: unknown): RecordingTrack {
  if (typeof json !== 'object' || json === null) return invalidTrack()
  const raw = json as Record<string, unknown>
  if (raw.version !== 1) return invalidTrack()
  if (raw.kind !== 'window' && raw.kind !== 'monitor') return invalidTrack()
  if (!isPositiveInteger(raw.width) || !isPositiveInteger(raw.height) || !isPositiveInteger(raw.fps)) return invalidTrack()
  if (typeof raw.durationMs !== 'number' || !Number.isFinite(raw.durationMs) || raw.durationMs < 0) return invalidTrack()
  if (typeof raw.scale !== 'number' || !Number.isFinite(raw.scale) || raw.scale <= 0) return invalidTrack()
  if (!Array.isArray(raw.shapes)) return invalidTrack()

  const shapes = raw.shapes.map(shapeNamed)
  const cursor = rowsOf(raw.cursor, CURSOR_ROW_LENGTH)
    .filter(isFiniteRow)
    .map(([t, x, y, shapeIndex]): CursorSample => ({
      t,
      x,
      y,
      shape: shapeIndex === HIDDEN_SHAPE_INDEX ? null : (shapes[shapeIndex] ?? 'other')
    }))
    .sort((a, b) => a.t - b.t)
  const clicks = rowsOf(raw.clicks, CLICK_ROW_LENGTH)
    .filter(isFiniteRow)
    .map(([t, x, y, button, up]): Click => ({
      t,
      x,
      y,
      button: button === 0 ? 'left' : 'right',
      up: up === NO_RELEASE ? null : up
    }))
    .sort((a, b) => a.t - b.t)

  return { kind: raw.kind, width: raw.width, height: raw.height, fps: raw.fps, durationMs: raw.durationMs, scale: raw.scale, cursor, clicks }
}

export function isInFrame(click: Click, frame: Size): boolean {
  return click.x >= 0 && click.x <= frame.width && click.y >= 0 && click.y <= frame.height
}

export function isShownClick(click: Click, frame: Size): boolean {
  return click.button === 'left' && isInFrame(click, frame)
}

function couldBeOnTaskbar(click: Click, track: RecordingTrack): boolean {
  if (track.kind === 'window') return !isInFrame(click, track)
  const nearestEdgePx = Math.min(click.x, track.width - click.x, click.y, track.height - click.y)
  return nearestEdgePx <= TASKBAR_ZONE_PX * track.scale
}

export function stopClickOf(track: RecordingTrack, stoppedBy: RecordingFinished['stoppedBy']): Click | null {
  const last = track.clicks.at(-1)
  if (stoppedBy !== 'window' || last === undefined || last.t < track.durationMs - STOP_CLICK_WITHIN_MS) return null
  return couldBeOnTaskbar(last, track) ? last : null
}

export function withoutStopClick(track: RecordingTrack, stoppedBy: RecordingFinished['stoppedBy']): RecordingTrack {
  return stopClickOf(track, stoppedBy) ? { ...track, clicks: track.clicks.slice(0, -1) } : track
}
