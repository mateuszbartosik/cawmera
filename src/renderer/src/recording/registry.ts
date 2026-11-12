import { useSyncExternalStore } from 'react'
import type { RecordingTrack } from './track'

export interface RecordingEntry {
  id: string
  name: string
  track: RecordingTrack
  poster: ImageBitmap | null
}

export const POSTER_OUTPUT_MS = 0
export const POSTER_SOURCE_MS = 0

const recordings = new Map<string, RecordingEntry>()
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
