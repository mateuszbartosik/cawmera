import { ALL_FORMATS, BufferTarget, CanvasSource, Input, Mp4OutputFormat, Output, Quality, UrlSource, VideoSampleSink } from 'mediabunny'
import { recordingUrl } from '@shared/media'
import type { Doc } from '../app/doc'
import type { HouseStyle } from '../app/house-style'
import { drawRecordingFrame } from './frame'
import type { RecordingEntry } from './registry'
import { recordingScene } from './scene'
import type { RecordingDoc } from './settings'
import type { Trim } from './trim'

const MS_PER_SECOND = 1000
const FRAME_COUNT_TOLERANCE = 1e-9

/** Source time in ms of each output frame; a trim shorter than one frame still yields one. */
export function frameTimes(trim: Trim, fps: number): number[] {
  const count = Math.max(1, Math.ceil(((trim.end - trim.start) * fps) / MS_PER_SECOND - FRAME_COUNT_TOLERANCE))
  return Array.from({ length: count }, (_, i) => trim.start + (i * MS_PER_SECOND) / fps)
}

export async function exportRecordingVideo(
  entry: RecordingEntry,
  doc: Doc & { recording: RecordingDoc },
  style: HouseStyle,
  backdrop: ImageBitmap | null,
  onProgress: (share: number) => void
): Promise<Blob> {
  const { fps, trim } = doc.recording
  const times = frameTimes(trim, fps)
  const input = new Input({ source: new UrlSource(recordingUrl(entry.id)), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('The recording has no video.')
    const firstFrameSeconds = await track.getFirstTimestamp()

    const canvas = new OffscreenCanvas(doc.size.width, doc.size.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('The browser could not create a canvas for the export.')
    const target = new BufferTarget()
    const output = new Output({ format: new Mp4OutputFormat(), target })
    const encoder = new CanvasSource(canvas, { codec: 'avc', bitrate: new Quality('high') })
    output.addVideoTrack(encoder, { frameRate: fps })
    await output.start()

    try {
      const sourceSeconds = times.map((ms) => Math.max(ms / MS_PER_SECOND, firstFrameSeconds))
      const samples = new VideoSampleSink(track).samplesAtTimestamps(sourceSeconds)
      let index = 0
      for await (const sample of samples) {
        try {
          if (!sample) throw new Error('The recording has no picture at this point.')
          const scene = recordingScene(entry, doc, style, backdrop, sample.toCanvasImageSource())
          if (!scene) throw new Error('This shot is not a recording.')
          drawRecordingFrame(ctx, scene, times[index], 'export')
        } finally {
          sample?.close()
        }
        await encoder.add(index / fps, 1 / fps)
        index++
        onProgress(index / times.length)
      }
      await output.finalize()
    } catch (error) {
      await output.cancel().catch(() => undefined)
      throw error
    }
    return new Blob([target.buffer!], { type: 'video/mp4' })
  } finally {
    input.dispose()
  }
}
