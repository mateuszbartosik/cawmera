import { useSyncExternalStore } from 'react'
import { store } from '../app/store'
import type { RecordingPlayer } from './player'
import type { TimeMap } from './timemap'
import type { Trim } from './trim'

let activePlayer: RecordingPlayer | null = null

/**
 * The playhead (source ms) lives here, not in the store: it changes on every video frame and only the
 * timeline shows it. The store's `playback.time` is the time of the frame on screen, kept whenever playback is not running.
 */
let playhead = 0
const playheadListeners = new Set<() => void>()

/** A scrub the video hasn't caught up with yet: the playhead is at `target`, ahead of the frame on screen. */
interface Scrub {
  player: RecordingPlayer
  target: number
}

let scrub: Scrub | null = null

function movePlayhead(sourceMs: number) {
  playhead = sourceMs
  for (const listener of playheadListeners) listener()
}

function keepFrameTime(sourceMs: number) {
  if (!store.get().playback.playing) store.set((s) => ({ playback: { ...s.playback, time: sourceMs } }))
}

/** The frame at `sourceMs` is on screen. The playhead follows it, unless a scrub has it ahead of the video. */
export function setPlayhead(sourceMs: number) {
  if (!scrub) movePlayhead(sourceMs)
  keepFrameTime(sourceMs)
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
  scrub = null
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

/**
 * The playhead goes to `sourceMs` at once and the video follows, one seek at a time and always to the latest point, so the seeks
 * of a drag on the ruler, the playhead or a trim handle never pile up. The last seek goes exactly where the playhead stopped.
 */
export function scrubTo(sourceMs: number) {
  if (!activePlayer) return setPlayhead(sourceMs)
  movePlayhead(sourceMs)
  if (scrub) {
    scrub.target = sourceMs
    return
  }
  scrub = { player: activePlayer, target: sourceMs }
  void followScrub(scrub)
}

async function followScrub(current: Scrub) {
  let landedAt: number
  do {
    landedAt = current.target
    await current.player.seekAndWait(landedAt)
    if (scrub !== current) return
  } while (current.target !== landedAt)
  scrub = null
  setPlayhead(current.player.time)
}

export const currentPlayhead = () => playhead

export async function grabPlayheadFrame(): Promise<ImageBitmap | null> {
  return (await activePlayer?.grabFrame()) ?? null
}
