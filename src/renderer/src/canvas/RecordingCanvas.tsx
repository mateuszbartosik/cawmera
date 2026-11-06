import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CanvasHTMLAttributes } from 'react'
import type { Doc } from '../app/doc'
import type { HouseStyle } from '../app/house-style'
import { store } from '../app/store'
import { drawRecordingFrame, type RecordingScene } from '../recording/frame'
import { attachPlayer } from '../recording/playback'
import { RecordingPlayer } from '../recording/player'
import { cursorPathFor, getRecording, type RecordingEntry } from '../recording/registry'
import type { Size } from '../render/geometry'
import { recordingUrl } from '@shared/media'

const STORE_WRITE_INTERVAL_MS = 33

export function recordingScene(
  entry: RecordingEntry,
  doc: Doc,
  style: HouseStyle,
  backdrop: ImageBitmap | null,
  video: CanvasImageSource
): RecordingScene | null {
  if (!doc.recording) return null
  return {
    video,
    videoSize: { width: entry.track.width, height: entry.track.height },
    track: entry.track,
    zooms: entry.zooms,
    path: cursorPathFor(entry, doc.recording.smoothing),
    doc,
    settings: doc.recording,
    style,
    backdrop
  }
}

export function sizeCanvas(canvas: HTMLCanvasElement, size: Size, backingWidth: number) {
  const backingHeight = Math.max(1, Math.round((backingWidth * size.height) / size.width))
  if (canvas.width !== backingWidth) canvas.width = backingWidth
  if (canvas.height !== backingHeight) canvas.height = backingHeight
}

interface Props {
  doc: Doc
  style: HouseStyle
  backdrop: ImageBitmap | null
  backingWidth: number
  canvasProps: CanvasHTMLAttributes<HTMLCanvasElement> & { 'data-testid'?: string; 'data-active'?: boolean }
}

/** The active recording shot: its own player drives the canvas, which is redrawn on every video frame. */
export function RecordingCanvas({ doc, style, backdrop, backingWidth, canvasProps }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef<(sourceMs: number) => void>(() => undefined)
  const [player, setPlayer] = useState<RecordingPlayer | null>(null)
  const entry = getRecording(doc.sourceId)
  const entryId = entry?.id ?? null
  const trim = doc.recording?.trim

  useEffect(() => {
    if (!entryId) return
    const created = new RecordingPlayer(recordingUrl(entryId))
    const { start = 0, end = Number.POSITIVE_INFINITY } = store.get().doc.recording?.trim ?? {}
    let lastWrite = 0
    const offFrame = created.onFrame((time) => {
      drawRef.current(time)
      const now = performance.now()
      if (!store.get().playback.playing || now - lastWrite >= STORE_WRITE_INTERVAL_MS) {
        lastWrite = now
        store.set((s) => ({ playback: { ...s.playback, time } }))
      }
    })
    const offPlaying = created.onPlayingChange((playing) => store.set((s) => ({ playback: { ...s.playback, playing } })))
    created.setTrim({ start, end })
    created.seek(start)
    store.set({ playback: { playing: false, time: start } })
    attachPlayer(created)
    setPlayer(created)
    return () => {
      offFrame()
      offPlaying()
      attachPlayer(null)
      setPlayer(null)
      created.dispose()
      store.set((s) => ({ playback: { ...s.playback, playing: false } }))
    }
  }, [entryId])

  useEffect(() => {
    if (trim) player?.setTrim(trim)
  }, [player, trim])

  const scene = useMemo(
    () => (entry && player ? recordingScene(entry, doc, style, backdrop, player.video) : null),
    [entry, player, doc, style, backdrop]
  )

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !player) return
    sizeCanvas(canvas, doc.size, backingWidth)
    const k = backingWidth / doc.size.width
    drawRef.current = (sourceMs) => {
      if (scene) drawRecordingFrame(ctx, scene, sourceMs, 'preview', k)
    }
    drawRef.current(player.time)
  }, [scene, player, doc.size, backingWidth])

  return <canvas ref={canvasRef} {...canvasProps} />
}
