import { ALL_FORMATS, BufferTarget, CanvasSource, Input, Mp4OutputFormat, Output, Quality, UrlSource, VideoSampleSink } from 'mediabunny'
import { recordingUrl } from '@shared/media'
import type { Doc } from '../app/doc'
import type { HouseStyle } from '../app/house-style'
import { drawRecordingFrame } from './frame'
import type { RecordingEntry } from './registry'
import { recordingScene } from './scene'
import type { RecordingDoc } from './settings'
import { outputFrameTimes, outputToSource } from './timemap'

const MS_PER_SECOND = 1000

export async function exportRecordingVideo(
  entry: RecordingEntry,
  doc: Doc & { recording: RecordingDoc },
  style: HouseStyle,
  backdrop: ImageBitmap | null,
  onProgress: (share: number) => void
): Promise<Uint8Array> {
  const { fps } = doc.recording
  const input = new Input({
    source: new UrlSource(recordingUrl(entry.id), { getRetryDelay: () => null }),
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
      let index = 0
      for await (const sample of samples) {
        try {
          if (!sample) throw new Error('The recording has no picture at this point.')
          drawRecordingFrame(ctx, { ...scene, video: sample.toCanvasImageSource() }, times[index], 'export')
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
    return new Uint8Array(target.buffer!)
  } finally {
    input.dispose()
  }
}
