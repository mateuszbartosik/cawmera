import type { Doc } from '../app/doc'
import type { HouseStyle } from '../app/house-style'
import type { RecordingScene } from './frame'
import { cursorPathFor, zoomsFor, type RecordingEntry } from './registry'

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
    zooms: zoomsFor(entry, doc.recording.trim, doc.recording.zoomSpeed),
    path: cursorPathFor(entry, doc.recording.smoothing),
    doc,
    settings: doc.recording,
    style,
    backdrop
  }
}
