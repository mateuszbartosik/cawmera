import { store } from '../app/store'
import type { RecordingPlayer } from './player'

let activePlayer: RecordingPlayer | null = null

export function attachPlayer(player: RecordingPlayer | null) {
  activePlayer = player
}

export function togglePlayback() {
  if (!activePlayer) return
  if (store.get().playback.playing) activePlayer.pause()
  else activePlayer.play()
}

export function scrubTo(sourceMs: number) {
  if (activePlayer) activePlayer.seek(sourceMs)
  else store.set((s) => ({ playback: { ...s.playback, time: sourceMs } }))
}
