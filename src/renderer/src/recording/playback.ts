import { useSyncExternalStore } from 'react'
import { store } from '../app/store'
import type { RecordingPlayer } from './player'
import type { TimeMap } from './timemap'
import type { Trim } from './trim'

let activePlayer: RecordingPlayer | null = null

/**
 * The playhead (source ms) lives here, not in the store: it changes on every video frame and only the
 * timeline shows it. The store's `playback.time` is updated whenever playback is not running.
 */
let playhead = 0
const playheadListeners = new Set<() => void>()

export function setPlayhead(sourceMs: number) {
  playhead = sourceMs
  for (const listener of playheadListeners) listener()
  if (!store.get().playback.playing) store.set((s) => ({ playback: { ...s.playback, time: sourceMs } }))
}

export function usePlayhead(): number {
  return useSyncExternalStore(
    (listener) => {
      playheadListeners.add(listener)
      return () => playheadListeners.delete(listener)
    },
    () => playhead
  )
}

export function setPlaying(playing: boolean) {
  store.set((s) => ({
    playback: { playing, time: playing ? s.playback.time : playhead },
    ...(playing ? { selection: [], timelineSelection: s.timelineSelection?.kind === 'range' ? s.timelineSelection : null } : {})
  }))
}

export function attachPlayer(player: RecordingPlayer | null) {
  activePlayer = player
}

export function togglePlayback() {
  if (!activePlayer) return
  if (store.get().playback.playing) activePlayer.pause()
  else activePlayer.play()
}

/** Paused at once in the store, before the video reports it, so nothing drawn next counts as playing. */
export function pausePlayback() {
  if (!store.get().playback.playing) return
  activePlayer?.pause()
  setPlaying(false)
}

export function applyTimeMap(map: TimeMap, trim: Trim) {
  activePlayer?.setTimeMap(map, trim)
}

export function scrubTo(sourceMs: number) {
  if (activePlayer) activePlayer.seek(sourceMs)
  else setPlayhead(sourceMs)
}

export const currentPlayhead = () => playhead

export async function grabPlayheadFrame(): Promise<ImageBitmap | null> {
  return (await activePlayer?.grabFrame()) ?? null
}
