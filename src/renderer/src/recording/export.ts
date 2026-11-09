import { ALL_FORMATS, BufferTarget, CanvasSource, Input, Mp4OutputFormat, Output, Quality, UrlSource, VideoSampleSink, type Source } from 'mediabunny'
import { recordingUrl } from '@shared/media'
import type { Doc } from '../app/doc'
import type { HouseStyle } from '../app/house-style'
import { drawRecordingFrame, sampleTimes } from './frame'
import type { RecordingEntry } from './registry'
import { recordingScene } from './scene'
import type { RecordingDoc } from './settings'
import { outputFrameTimes, outputToSource } from './timemap'

const MS_PER_SECOND = 1000

export interface ExportTiming {
  frames: number
  decodeWaitMs: number
  drawMs: number
  encodeWaitMs: number
  /** Part of `drawMs` spent on frames drawn from more than one blur sample. */
  blurDrawMs: number
  blurredFrames: number
  drawnSamples: number
  /** Flushing the encoder and finishing the file. */
  finalizeMs: number
}

export interface ExportOptions {
  source?: Source
  onTiming?: (timing: ExportTiming) => void
  /** Waits, without reading pixels back, for the canvas work of every frame inside the draw stage, so the GPU's share lands in `drawMs`, not in `encodeWaitMs`. */
  settleDraws?: boolean
}

/** Waits for a canvas's queued work by reading one pixel of a snapshot into a CPU canvas, so the canvas itself is never read back. */
function drawSettler(canvas: OffscreenCanvas): () => Promise<void> {
  const probe = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!
  return async () => {
    const snapshot = await createImageBitmap(canvas)
    probe.drawImage(snapshot, 0, 0, 1, 1)
    probe.getImageData(0, 0, 1, 1)
    snapshot.close()
  }
}

export async function exportRecordingVideo(
  entry: RecordingEntry,
  doc: Doc & { recording: RecordingDoc },
  style: HouseStyle,
  backdrop: ImageBitmap | null,
  onProgress: (share: number) => void,
  options: ExportOptions = {}
): Promise<Uint8Array> {
  const { fps } = doc.recording
  const input = new Input({
    source: options.source ?? new UrlSource(recordingUrl(entry.id), { getRetryDelay: () => null }),
    formats: ALL_FORMATS
  })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('The recording has no video.')
    const firstFrameSeconds = await track.getFirstTimestamp()

    const canvas = new OffscreenCanvas(doc.size.width, doc.size.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('The browser could not create a canvas for the export.')
    const scene = recordingScene(entry, doc, style, backdrop, canvas)!
    const { map } = scene.view
    const times = outputFrameTimes(map, fps)
    const target = new BufferTarget()
    const output = new Output({ format: new Mp4OutputFormat(), target })
    const encoder = new CanvasSource(canvas, { codec: 'avc', quality: new Quality('high') })
    output.addVideoTrack(encoder, { frameRate: fps })
    await output.start()

    try {
      const sourceSeconds = times.map((outputMs) => Math.max(outputToSource(map, outputMs) / MS_PER_SECOND, firstFrameSeconds))
      const samples = new VideoSampleSink(track).samplesAtTimestamps(sourceSeconds)
      const timing: ExportTiming = { frames: 0, decodeWaitMs: 0, drawMs: 0, encodeWaitMs: 0, blurDrawMs: 0, blurredFrames: 0, drawnSamples: 0, finalizeMs: 0 }
      const settle = options.settleDraws ? drawSettler(canvas) : null
      const iterator = samples[Symbol.asyncIterator]()
      let index = 0
      try {
        for (;;) {
          const decodeStart = performance.now()
          const next = await iterator.next()
          timing.decodeWaitMs += performance.now() - decodeStart
          if (next.done) break
          const sample = next.value
          try {
            if (!sample) throw new Error('The recording has no picture at this point.')
            const frameScene = { ...scene, video: sample.toCanvasImageSource() }
            const sampleCount = options.onTiming ? sampleTimes(frameScene, times[index], 'export').length : 1
            const drawStart = performance.now()
            drawRecordingFrame(ctx, frameScene, times[index], 'export')
            if (settle) await settle()
            const drawMs = performance.now() - drawStart
            timing.drawMs += drawMs
            timing.drawnSamples += sampleCount
            if (sampleCount > 1) {
              timing.blurDrawMs += drawMs
              timing.blurredFrames++
            }
          } finally {
            sample?.close()
          }
          const encodeStart = performance.now()
          await encoder.add(index / fps, 1 / fps)
          timing.encodeWaitMs += performance.now() - encodeStart
          index++
          onProgress(index / times.length)
        }
      } finally {
        await iterator.return?.()
      }
      timing.frames = index
      const finalizeStart = performance.now()
      await output.finalize()
      timing.finalizeMs = performance.now() - finalizeStart
      options.onTiming?.(timing)
    } catch (error) {
      await output.cancel().catch(() => undefined)
      throw error
    }
    return new Uint8Array(target.buffer!)
  } finally {
    input.dispose()
  }
}
