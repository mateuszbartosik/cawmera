import { useSyncExternalStore } from 'react'
import { store } from '../app/store'
import type { RecordingPlayer } from './player'
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
  store.set((s) => ({ playback: { playing, time: playing ? s.playback.time : playhead } }))
}

export function attachPlayer(player: RecordingPlayer | null) {
  activePlayer = player
}

export function togglePlayback() {
  if (!activePlayer) return
  if (store.get().playback.playing) activePlayer.pause()
  else activePlayer.play()
}

export function applyTrim(trim: Trim) {
  activePlayer?.setTrim(trim)
}

export function scrubTo(sourceMs: number) {
  if (activePlayer) activePlayer.seek(sourceMs)
  else setPlayhead(sourceMs)
}
