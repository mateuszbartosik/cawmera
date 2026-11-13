import { pieceAt } from '../recording/pieces'
import type { Piece } from '../recording/timemap'
import { isShownClick, isShownClickIn, type RecordingTrack } from '../recording/track'
import type { Trim } from '../recording/trim'
import type { Rect } from '../render/geometry'

/** `key` is the click's place in the track, since two clicks can share a time. */
export interface ClickDot { key: number; t: number; dimmed: boolean }

/**
 * The take's left clicks in the video, as dots on the Clip row. A click that drives nothing is dimmed: one in a cut, outside the
 * trim, or outside the crop (video px).
 */
export function clickDots(track: Pick<RecordingTrack, 'clicks' | 'width' | 'height'>, pieces: Piece[], trim: Trim, crop: Rect): ClickDot[] {
  return track.clicks.flatMap((click, key) => {
    if (!isShownClick(click, track)) return []
    const drivesNothing = pieceAt(pieces, click.t).cut || click.t < trim.start || click.t > trim.end || !isShownClickIn(click, crop)
    return [{ key, t: click.t, dimmed: drivesNothing }]
  })
}
