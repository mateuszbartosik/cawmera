import type { HouseStyle } from '../app/house-style'
import { rect, type Rect, type Size } from '../render/geometry'

/** Export px. `content` is where the whole video sits before any zoom. */
export interface RecordingLayout {
  content: Rect
  scale: number
}

export function recordingLayout(video: Size, output: Size, style: Pick<HouseStyle, 'inset'>): RecordingLayout {
  const fit = Math.min((output.width - 2 * style.inset) / video.width, (output.height - 2 * style.inset) / video.height)
  const scale = Math.min(1, fit)
  const width = Math.round(video.width * scale)
  const height = Math.round(video.height * scale)
  const content = rect(Math.round((output.width - width) / 2), Math.round((output.height - height) / 2), width, height)
  return { content, scale }
}
