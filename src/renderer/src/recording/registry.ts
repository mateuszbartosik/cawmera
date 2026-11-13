import { useSyncExternalStore } from 'react'
import { recordingUrl } from '@shared/media'
import type { RecordingTrack } from './track'

export interface RecordingEntry {
  id: string
  name: string
  track: RecordingTrack
  poster: ImageBitmap | null
}

export const POSTER_OUTPUT_MS = 0
export const POSTER_SOURCE_MS = 0
const POSTER_TIMEOUT_MS = 5000

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

function grabFirstFrame(id: string): Promise<ImageBitmap | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    let settled = false
    const finish = (poster: ImageBitmap | null) => {
      if (settled) return poster?.close()
      settled = true
      clearTimeout(timer)
      video.onerror = video.onloadeddata = null
      video.removeAttribute('src')
      video.load()
      resolve(poster)
    }
    const timer = setTimeout(() => finish(null), POSTER_TIMEOUT_MS)
    video.muted = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.onerror = () => finish(null)
    video.onloadeddata = () => void createImageBitmap(video).then(finish, () => finish(null))
    video.src = recordingUrl(id)
  })
}

/** The take's first frame becomes its poster, drawn until the video can play; a take that can't be read keeps none. */
export async function loadPoster(id: string) {
  const poster = await grabFirstFrame(id)
  if (poster) setPoster(id, poster)
}

export function getRecording(id: string | null): RecordingEntry | null {
  return id ? (recordings.get(id) ?? null) : null
}

export function useRecording(id: string | null): RecordingEntry | null {
  return useSyncExternalStore(subscribe, () => getRecording(id))
}
