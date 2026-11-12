import type { Doc } from '../app/doc'
import type { HouseStyle } from '../app/house-style'
import type { RecordingScene } from './frame'
import type { RecordingEntry } from './registry'
import { takeViewFor } from './take-view'

export function recordingScene(
  entry: RecordingEntry,
  doc: Doc,
  style: HouseStyle,
  backdrop: ImageBitmap | null,
  video: CanvasImageSource,
  wide = false
): RecordingScene | null {
  if (!doc.recording) return null
  return {
    video,
    videoSize: { width: entry.track.width, height: entry.track.height },
    view: takeViewFor(entry, doc.recording, doc.crop),
    doc,
    settings: doc.recording,
    style,
    backdrop,
    wide
  }
}
