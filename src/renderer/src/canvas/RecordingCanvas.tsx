import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CanvasHTMLAttributes } from 'react'
import { toast } from 'sonner'
import type { Doc } from '../app/doc'
import type { HouseStyle } from '../app/house-style'
import { store, useApp } from '../app/store'
import { drawRecordingFrame } from '../recording/frame'
import { attachPlayer, setPlayhead, setPlaying } from '../recording/playback'
import { RecordingPlayer } from '../recording/player'
import { POSTER_OUTPUT_MS, useRecording } from '../recording/registry'
import { recordingScene } from '../recording/scene'
import { takeViewFor } from '../recording/take-view'
import { snapToOutput, timeMapOf } from '../recording/timemap'
import { selectedZoomOf } from '../recording/zoom-actions'
import type { Size } from '../render/geometry'
import { recordingUrl } from '@shared/media'

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
  const entry = useRecording(doc.sourceId)
  const entryId = entry?.id ?? null
  const trim = doc.recording?.trim
  const boxSelected = useApp((s) => s.selection.length > 0)
  const timelineSelection = useApp((s) => s.timelineSelection)
  const takeView = entry && doc.recording ? takeViewFor(entry, doc.recording, doc.crop) : null
  const edits = takeView?.edits ?? []
  const map = takeView?.map
  const wide = boxSelected || selectedZoomOf(edits, timelineSelection) !== null

  useEffect(() => {
    if (!entryId) return
    const created = new RecordingPlayer(recordingUrl(entryId))
    const recording = store.get().doc.recording
    const start = recording?.trim.start ?? 0
    const offFrame = created.onFrame((time) => {
      drawRef.current(time)
      setPlayhead(time)
    })
    const offPlaying = created.onPlayingChange(setPlaying)
    const offError = created.onError(() =>
      toast.error('The recording could not be played', { id: `recording-error-${entryId}`, description: 'Its file may be missing or damaged.' })
    )
    if (recording) created.setTimeMap(timeMapOf(recording.trim, recording.pieces), recording.trim)
    created.seek(start)
    setPlayhead(start)
    store.set({ playback: { playing: false, time: start } })
    attachPlayer(created)
    setPlayer(created)
    return () => {
      offFrame()
      offPlaying()
      offError()
      attachPlayer(null)
      setPlayer(null)
      created.dispose()
      store.set((s) => ({ playback: { ...s.playback, playing: false } }))
    }
  }, [entryId])

  useEffect(() => {
    if (trim && map) player?.setTimeMap(map, trim)
  }, [player, map, trim])

  const scene = useMemo(
    () => (entry && player ? recordingScene(entry, doc, style, backdrop, player.video, wide) : null),
    [entry, player, doc, style, backdrop, wide]
  )
  const posterScene = useMemo(
    () => (entry?.poster ? recordingScene(entry, doc, style, backdrop, entry.poster, wide) : null),
    [entry, doc, style, backdrop, wide]
  )

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    sizeCanvas(canvas, doc.size, backingWidth)
    const k = backingWidth / doc.size.width
    const draw = (sourceMs: number) => {
      const playable = scene !== null && player !== null && player.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      if (playable) drawRecordingFrame(ctx, scene, snapToOutput(scene.view.map, sourceMs), 'preview', k)
      else if (posterScene) drawRecordingFrame(ctx, posterScene, POSTER_OUTPUT_MS, 'preview', k)
    }
    drawRef.current = draw
    draw(player ? player.time : 0)
  }, [scene, posterScene, player, doc.size, backingWidth])

  return <canvas ref={canvasRef} {...canvasProps} />
}
