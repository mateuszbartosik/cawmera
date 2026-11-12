import type { Trim } from './trim'
import { timeMapOf, wholeTake, type TimeMap } from './timemap'
import { clampToTrim, playbackStart, rateAt, stepAt } from './trim-loop'

type FrameListener = (sourceMs: number) => void
type PlayingListener = (playing: boolean) => void
type ErrorListener = () => void

const MS_PER_SECOND = 1000

export class RecordingPlayer {
  readonly video = document.createElement('video')
  private trim: Trim = { start: 0, end: Number.POSITIVE_INFINITY }
  private map: TimeMap = timeMapOf(this.trim, wholeTake(Number.POSITIVE_INFINITY))
  private readonly frameListeners = new Set<FrameListener>()
  private readonly playingListeners = new Set<PlayingListener>()
  private readonly errorListeners = new Set<ErrorListener>()
  private finished = false
  private frameRequest: number | null = null
  private disposed = false

  constructor(url: string) {
    const { video } = this
    video.muted = true
    video.preload = 'auto'
    video.playsInline = true
    video.crossOrigin = 'anonymous'
    video.addEventListener('loadeddata', this.announceFrame)
    video.addEventListener('seeked', this.announceFrame)
    video.addEventListener('play', this.onPlay)
    video.addEventListener('pause', this.onPause)
    video.addEventListener('ended', this.onEnded)
    video.addEventListener('error', this.emitError)
    video.src = url
  }

  get time(): number {
    return this.video.currentTime * MS_PER_SECOND
  }

  setTimeMap(map: TimeMap, trim: Trim) {
    this.map = map
    this.trim = trim
    this.video.playbackRate = rateAt(this.time, map)
  }

  play() {
    const from = playbackStart(this.time, this.map, this.finished)
    if (from !== this.time) this.seek(from)
    this.video.playbackRate = rateAt(from, this.map)
    void this.video.play().catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) this.emitError()
    })
  }

  pause() {
    this.video.pause()
  }

  seek(sourceMs: number) {
    this.finished = false
    this.setVideoTime(clampToTrim(sourceMs, this.trim))
  }

  private setVideoTime(sourceMs: number) {
    this.video.currentTime = sourceMs / MS_PER_SECOND
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  onPlayingChange(listener: PlayingListener): () => void {
    this.playingListeners.add(listener)
    return () => this.playingListeners.delete(listener)
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  dispose() {
    this.disposed = true
    this.cancelFrameRequest()
    const { video } = this
    video.removeEventListener('loadeddata', this.announceFrame)
    video.removeEventListener('seeked', this.announceFrame)
    video.removeEventListener('play', this.onPlay)
    video.removeEventListener('pause', this.onPause)
    video.removeEventListener('ended', this.onEnded)
    video.removeEventListener('error', this.emitError)
    video.pause()
    video.removeAttribute('src')
    video.load()
    this.frameListeners.clear()
    this.playingListeners.clear()
    this.errorListeners.clear()
  }

  private announceFrame = () => this.emitFrame(this.time)

  private emitFrame(sourceMs: number) {
    for (const listener of this.frameListeners) listener(sourceMs)
  }

  private emitPlaying(playing: boolean) {
    for (const listener of this.playingListeners) listener(playing)
  }

  private emitError = () => {
    for (const listener of this.errorListeners) listener()
  }

  private finish() {
    this.video.pause()
    this.setVideoTime(this.map.spans.at(-1)?.source.end ?? this.trim.end)
    this.finished = true
  }

  private onEnded = () => {
    this.finish()
    this.emitFrame(Math.min(this.trim.end, this.time))
  }

  private onPlay = () => {
    this.requestFrame()
    this.emitPlaying(true)
  }

  private onPause = () => {
    this.cancelFrameRequest()
    this.emitPlaying(false)
  }

  private requestFrame() {
    if (this.disposed || this.frameRequest !== null) return
    this.frameRequest = this.video.requestVideoFrameCallback((_now, metadata) => {
      this.frameRequest = null
      this.onPresentedFrame(metadata.mediaTime * MS_PER_SECOND)
    })
  }

  private cancelFrameRequest() {
    if (this.frameRequest === null) return
    this.video.cancelVideoFrameCallback(this.frameRequest)
    this.frameRequest = null
  }

  private onPresentedFrame(sourceMs: number) {
    const step = stepAt(sourceMs, this.map)
    if (step.kind === 'end') {
      this.finish()
      return
    }
    if (step.kind === 'jump') {
      this.video.playbackRate = rateAt(step.to, this.map)
      this.setVideoTime(step.to)
    } else {
      this.video.playbackRate = step.rate
      this.emitFrame(sourceMs)
    }
    if (!this.video.paused) this.requestFrame()
  }
}
