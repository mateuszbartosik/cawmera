import type { HouseStyle } from '../app/house-style'
import { drawFrameShadowAlone } from '../render/compose'
import type { Rect, Size } from '../render/geometry'

type ShadowStyle = Pick<HouseStyle, 'shadow'>

const stages = new WeakMap<object, { key: string; canvas: OffscreenCanvas }>()

export function stageKey(size: Size, content: Rect, radius: number, style: ShadowStyle): string {
  return [size.width, size.height, content.x, content.y, content.w, content.h, radius, style.shadow].join(' ')
}

/**
 * The frame’s shadow, cast once on a clear canvas the size of the export, in composition px, to lay under every frame.
 * Each owner keeps its last stage, and it goes with the owner.
 */
export function stageFor(owner: object, size: Size, content: Rect, radius: number, style: ShadowStyle): OffscreenCanvas {
  const key = stageKey(size, content, radius, style)
  const kept = stages.get(owner)
  if (kept?.key === key) return kept.canvas
  const canvas = new OffscreenCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The browser could not create a canvas for the export.')
  drawFrameShadowAlone(ctx, content, radius, style, 1)
  stages.set(owner, { key, canvas })
  return canvas
}
