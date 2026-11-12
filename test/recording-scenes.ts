import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { buildCameraPath, cameraTargets } from '../src/renderer/src/recording/camera'
import type { RecordingScene } from '../src/renderer/src/recording/frame'
import { DEFAULT_RECORDING, type RecordingDoc } from '../src/renderer/src/recording/settings'
import { takeViewFor, type TakeView } from '../src/renderer/src/recording/take-view'
import { wholeTake, type Piece } from '../src/renderer/src/recording/timemap'
import type { CursorSample, RecordingTrack } from '../src/renderer/src/recording/track'
import type { ZoomSegment } from '../src/renderer/src/recording/zooms'
import type { Rect } from '../src/renderer/src/render/geometry'

export const output = { width: 1920, height: 1080 }
export const video = { tag: 'video' } as unknown as CanvasImageSource
export const still: CursorSample[] = Array.from({ length: 400 }, (_, i) => ({ t: i * 16, x: 1280, y: 720, shape: 'arrow' }))
export const track: RecordingTrack = { kind: 'window', width: 2560, height: 1440, fps: 60, durationMs: 6400, scale: 1, cursor: still, clicks: [] }
export const settings: RecordingDoc = { ...DEFAULT_RECORDING, trim: { start: 0, end: 6400 }, pieces: wholeTake(6400), zooms: null }

export const viewOf = (take: RecordingTrack, crop: Rect | null = null, recording = settings) =>
  takeViewFor({ id: 'frame', name: 'Recording', poster: null, track: take }, recording, crop)
export const withZooms = (view: TakeView, zooms: ZoomSegment[]): TakeView =>
  ({ ...view, zooms, camera: buildCameraPath(cameraTargets(zooms, view.frame, settings.zoomSpeed), settings.zoomSpeed, view.frame) })
export const piece = (start: number, end: number, cut = false): Piece => ({ start, end, rate: 1, cut })

export const zoomIntoTheMiddle: ZoomSegment = { start: 3000, end: 5000, depth: 2, focus: { x: 1280, y: 720 } }

export const zoomScene: RecordingScene = {
  video,
  videoSize: { width: 2560, height: 1440 },
  view: withZooms(viewOf(track), [zoomIntoTheMiddle]),
  doc: { ...DEFAULT_DOC, size: output },
  settings,
  style: DEFAULT_HOUSE_STYLE,
  backdrop: null,
  wide: false
}
/** At 4000 the camera holds the zoom and the cursor rests in sight. */
export const stillScene: RecordingScene = { ...zoomScene, settings: { ...settings, hideWhenStill: false } }

export const fullHd = { width: 1920, height: 1080 }
const sweep: CursorSample[] = still.map((sample) => ({ ...sample, x: 300 + 3 * Math.min(Math.max(sample.t - 700, 0), 500), y: 540 }))
/** From 700 to 1200 ms the cursor moves 3 video px per ms. */
export const movingCursorScene: RecordingScene = { ...zoomScene, videoSize: fullHd, view: viewOf({ ...track, ...fullHd, cursor: sweep }) }
