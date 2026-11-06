import type { Trim } from './trim'

type FrameListener = (sourceMs: number) => void
type PlayingListener = (playing: boolean) => void

const MS_PER_SECOND = 1000
/** A video that stopped within this many ms of the trim end counts as finished, so Play starts over. */
const END_TOLERANCE_MS = 50

export class RecordingPlayer {
  readonly video = document.createElement('video')
  private trim: Trim = { start: 0, end: Number.POSITIVE_INFINITY }
  private readonly frameListeners = new Set<FrameListener>()
  private readonly playingListeners = new Set<PlayingListener>()
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
    video.src = url
  }

  get time(): number {
    return this.video.currentTime * MS_PER_SECOND
  }

  setTrim(trim: Trim) {
    this.trim = trim
  }

  play() {
    if (this.time < this.trim.start || this.time >= this.trim.end - END_TOLERANCE_MS) this.seek(this.trim.start)
    void this.video.play().catch(() => undefined)
  }

  pause() {
    this.video.pause()
  }

  seek(sourceMs: number) {
    this.video.currentTime = Math.max(0, sourceMs) / MS_PER_SECOND
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  onPlayingChange(listener: PlayingListener): () => void {
    this.playingListeners.add(listener)
    return () => this.playingListeners.delete(listener)
  }

  dispose() {
    this.disposed = true
    this.cancelFrameRequest()
    const { video } = this
    video.removeEventListener('loadeddata', this.announceFrame)
    video.removeEventListener('seeked', this.announceFrame)
    video.removeEventListener('play', this.onPlay)
    video.removeEventListener('pause', this.onPause)
    video.pause()
    video.removeAttribute('src')
    video.load()
    this.frameListeners.clear()
    this.playingListeners.clear()
  }

  private announceFrame = () => this.emitFrame(this.time)

  private emitFrame(sourceMs: number) {
    for (const listener of this.frameListeners) listener(sourceMs)
  }

  private emitPlaying(playing: boolean) {
    for (const listener of this.playingListeners) listener(playing)
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
    if (sourceMs >= this.trim.end) {
      this.video.pause()
      this.seek(this.trim.end)
      return
    }
    this.emitFrame(sourceMs)
    if (!this.video.paused) this.requestFrame()
  }
}
