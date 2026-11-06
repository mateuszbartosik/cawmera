import { buildCursorPath, type CursorPath } from './cursor'
import type { RecordingTrack } from './track'
import type { ZoomSegment } from './zooms'

export interface RecordingEntry {
  id: string
  name: string
  track: RecordingTrack
  zooms: ZoomSegment[]
  poster: ImageBitmap | null
}

interface CachedPath { smoothing: number; path: CursorPath }

const recordings = new Map<string, RecordingEntry>()
const cursorPaths = new Map<string, CachedPath>()

export function registerRecording(entry: RecordingEntry) {
  recordings.set(entry.id, entry)
  cursorPaths.delete(entry.id)
}

export function getRecording(id: string | null): RecordingEntry | null {
  return id ? (recordings.get(id) ?? null) : null
}

export function cursorPathFor(entry: RecordingEntry, smoothing: number): CursorPath {
  const cached = cursorPaths.get(entry.id)
  if (cached?.smoothing === smoothing) return cached.path
  const path = buildCursorPath(entry.track, smoothing)
  cursorPaths.set(entry.id, { smoothing, path })
  return path
}
