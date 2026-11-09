import { useSyncExternalStore } from 'react'
import type { ZoomSpeed } from './camera'
import { buildCursorPath, type CursorPath } from './cursor'
import type { RecordingTrack } from './track'
import type { Trim } from './trim'
import { autoZooms, type ZoomSegment } from './zooms'

export interface RecordingEntry {
  id: string
  name: string
  track: RecordingTrack
  poster: ImageBitmap | null
}

export const POSTER_TIME_MS = 0

interface CachedPath { smoothing: number; endMs: number; path: CursorPath }
interface CachedZooms { trim: Trim; speed: ZoomSpeed; zooms: ZoomSegment[] }

const recordings = new Map<string, RecordingEntry>()
const cursorPaths = new Map<string, CachedPath>()
const zoomSets = new Map<string, CachedZooms>()
const listeners = new Set<() => void>()

function announceChange() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function registerRecording(entry: RecordingEntry) {
  recordings.set(entry.id, entry)
  cursorPaths.delete(entry.id)
  zoomSets.delete(entry.id)
  announceChange()
}

export function setPoster(id: string, poster: ImageBitmap) {
  const entry = recordings.get(id)
  if (!entry) return poster.close()
  recordings.set(id, { ...entry, poster })
  announceChange()
}

export function getRecording(id: string | null): RecordingEntry | null {
  return id ? (recordings.get(id) ?? null) : null
}

export function useRecording(id: string | null): RecordingEntry | null {
  return useSyncExternalStore(subscribe, () => getRecording(id))
}

export function cursorPathFor(entry: RecordingEntry, smoothing: number, endMs: number): CursorPath {
  const cached = cursorPaths.get(entry.id)
  if (cached?.smoothing === smoothing && cached.endMs === endMs) return cached.path
  const path = buildCursorPath(entry.track, smoothing, endMs)
  cursorPaths.set(entry.id, { smoothing, endMs, path })
  return path
}

export function zoomsFor(entry: RecordingEntry, trim: Trim, speed: ZoomSpeed): ZoomSegment[] {
  const cached = zoomSets.get(entry.id)
  if (cached?.speed === speed && cached.trim.start === trim.start && cached.trim.end === trim.end) return cached.zooms
  const { track } = entry
  const zooms = autoZooms(track.clicks, { width: track.width, height: track.height }, trim, speed)
  zoomSets.set(entry.id, { trim, speed, zooms })
  return zooms
}
