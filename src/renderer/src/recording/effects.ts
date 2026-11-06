import type { Size } from '../render/geometry'
import { isInFrame, type Click } from './track'

export type ClickEffect = 'off' | 'ring' | 'ripple'
export const CLICK_EFFECT_MS = { ring: 450, ripple: 650 }
export const PRESS = { scale: 0.85, ms: 120 }
export interface ActiveClick { x: number; y: number; progress: number }

const PRESS_IN_MS = 40
const RIPPLE_RING_DELAY_MS = 120
const RING_START_RADIUS = 0.4
const RING_ALPHA = 0.9
const RIPPLE_ALPHA = 0.35
const RING_WIDTH_RATIO = 0.12

export function activeClicks(clicks: Click[], t: number, effect: ClickEffect, frame: Size): ActiveClick[] {
  if (effect === 'off') return []
  const duration = CLICK_EFFECT_MS[effect]
  const active: ActiveClick[] = []
  for (const click of clicks) {
    const elapsed = t - click.t
    if (click.button !== 'left' || elapsed < 0 || elapsed >= duration || !isInFrame(click, frame)) continue
    active.push({ x: click.x, y: click.y, progress: elapsed / duration })
  }
  return active
}

function smoothstep(amount: number): number {
  const clamped = Math.min(1, Math.max(0, amount))
  return clamped * clamped * (3 - 2 * clamped)
}

function pressDepth(click: Click, t: number): number {
  if (click.button !== 'left' || t < click.t) return 0
  const depthWhenReleased = smoothstep(((click.up ?? t) - click.t) / PRESS_IN_MS)
  if (click.up === null || t <= click.up) return smoothstep((t - click.t) / PRESS_IN_MS)
  return depthWhenReleased * (1 - smoothstep((t - click.up) / PRESS.ms))
}

export function pressScale(clicks: Click[], t: number): number {
  let deepest = 0
  for (const click of clicks) deepest = Math.max(deepest, pressDepth(click, t))
  return 1 - (1 - PRESS.scale) * deepest
}

function strokeRing(
  ctx: CanvasRenderingContext2D,
  click: ActiveClick,
  color: string,
  radiusPx: number,
  progress: number,
  baseAlpha: number
): void {
  const radius = radiusPx * (RING_START_RADIUS + (1 - RING_START_RADIUS) * progress)
  ctx.globalAlpha = baseAlpha * RING_ALPHA * (1 - progress)
  ctx.strokeStyle = color
  ctx.lineWidth = radiusPx * RING_WIDTH_RATIO
  ctx.beginPath()
  ctx.arc(click.x, click.y, radius, 0, Math.PI * 2)
  ctx.stroke()
}

export function drawClickEffect(
  ctx: CanvasRenderingContext2D,
  click: ActiveClick,
  effect: Exclude<ClickEffect, 'off'>,
  color: string,
  radiusPx: number
): void {
  ctx.save()
  const baseAlpha = ctx.globalAlpha
  if (effect === 'ring') {
    strokeRing(ctx, click, color, radiusPx, click.progress, baseAlpha)
  } else {
    ctx.globalAlpha = baseAlpha * RIPPLE_ALPHA * (1 - click.progress)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(click.x, click.y, radiusPx * click.progress, 0, Math.PI * 2)
    ctx.fill()
    const elapsed = click.progress * CLICK_EFFECT_MS.ripple
    const ringProgress = (elapsed - RIPPLE_RING_DELAY_MS) / (CLICK_EFFECT_MS.ripple - RIPPLE_RING_DELAY_MS)
    if (ringProgress > 0) strokeRing(ctx, click, color, radiusPx, ringProgress, baseAlpha)
  }
  ctx.restore()
}
