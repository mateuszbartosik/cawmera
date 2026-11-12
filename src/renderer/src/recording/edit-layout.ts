import type { HouseStyle } from '../app/house-style'
import type { Size } from '../render/geometry'
import type { Layout } from '../render/layout'
import { recordingLayout } from './layout'
import type { TakeView } from './take-view'

/** The shot as a screenshot of the whole frame, so render/layout’s mappings take video px to output px. */
export function recordingEditLayout(view: Pick<TakeView, 'crop' | 'frame'>, video: Size, output: Size, style: HouseStyle): Layout {
  const { content, scale } = recordingLayout(view.frame, output, style)
  return { scale, image: video, edge: 'c', sel: view.crop, content, frame: content }
}
