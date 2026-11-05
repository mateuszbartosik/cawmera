import type { Point } from '../render/geometry'
import type { CursorFrame } from './cursor'
import type { CursorShape } from './track'

export type CursorLook = 'light' | 'dark'

export const CURSOR_BASE_PX = 22

const ART_BOX = 32
const OUTLINE_WIDTH = 1.5
const SHADOW = { color: 'rgba(0,0,0,0.35)', blur: 3 }
const LOOKS: Record<CursorLook, { fill: string; outline: string }> = {
  light: { fill: '#ffffff', outline: '#1a1a1a' },
  dark: { fill: '#000000', outline: '#ffffff' }
}

const ARROW = 'M6 3 L6 25 L11.5 20 L15.5 28.5 L19 27 L15 18.5 L22 18.5 Z'
const SMALL_ARROW = 'M5 3 L5 22 L9.5 18 L13 25.5 L15.8 24.3 L12.4 17 L18 17 Z'
const CENTER = { x: 16, y: 16 }
const TOP_LEFT = { x: 5, y: 3 }

export const CURSOR_ART: Record<CursorShape, { d: string; hotspot: Point }> = {
  arrow: { d: ARROW, hotspot: { x: 6, y: 3 } },
  other: { d: ARROW, hotspot: { x: 6, y: 3 } },
  hand: {
    d: 'M12.5 4.5 Q12.5 3 14 3 Q15.5 3 15.5 4.5 V13 L17 12.5 Q18.5 12.2 19 13.5 Q20.5 13 21.5 14 Q23 13.8 23.5 15 V21 Q23.5 27 18.5 28 H15 Q12 28 10 25 L5.5 18 Q5 16.5 6.5 16 Q8 15.5 9 17 L12.5 20 Z',
    hotspot: { x: 14, y: 3 }
  },
  ibeam: { d: 'M11 4 H21 V6.5 H17.5 V25.5 H21 V28 H11 V25.5 H14.5 V6.5 H11 Z', hotspot: CENTER },
  wait: {
    d: 'M9 3 H23 V5 H21.5 V9 Q21.5 12 18.5 14.5 L17.5 16 L18.5 17.5 Q21.5 20 21.5 23 V27 H23 V29 H9 V27 H10.5 V23 Q10.5 20 13.5 17.5 L14.5 16 L13.5 14.5 Q10.5 12 10.5 9 V5 H9 Z',
    hotspot: CENTER
  },
  progress: {
    d: `${SMALL_ARROW} M22 17.5 a5.5 5.5 0 1 1 0 11 a5.5 5.5 0 1 1 0 -11 Z M22 20.5 a2.5 2.5 0 1 0 0 5 a2.5 2.5 0 1 0 0 -5 Z`,
    hotspot: TOP_LEFT
  },
  crosshair: {
    d: 'M14.5 4 H17.5 V14.5 H28 V17.5 H17.5 V28 H14.5 V17.5 H4 V14.5 H14.5 Z',
    hotspot: CENTER
  },
  'not-allowed': {
    d: 'M16 5 a11 11 0 1 1 0 22 a11 11 0 1 1 0 -22 Z M16 8 a8 8 0 1 0 0 16 a8 8 0 1 0 0 -16 Z M8.22 10.34 L10.34 8.22 L23.78 21.66 L21.66 23.78 Z',
    hotspot: CENTER
  },
  move: {
    d: 'M16 3 L21 8.5 H18 V14 H23.5 V11 L29 16 L23.5 21 V18 H18 V23.5 H21 L16 29 L11 23.5 H14 V18 H8.5 V21 L3 16 L8.5 11 V14 H14 V8.5 H11 Z',
    hotspot: CENTER
  },
  'resize-ew': { d: 'M3 16 L9 10.5 V14.5 H23 V10.5 L29 16 L23 21.5 V17.5 H9 V21.5 Z', hotspot: CENTER },
  'resize-ns': { d: 'M16 3 L21.5 9 H17.5 V23 H21.5 L16 29 L10.5 23 H14.5 V9 H10.5 Z', hotspot: CENTER },
  'resize-nwse': {
    d: 'M6.8 6.8 L14.9 7.2 L12.1 10 L22 19.9 L24.8 17.1 L25.2 25.2 L17.1 24.8 L19.9 22 L10 12.1 L7.2 14.9 Z',
    hotspot: CENTER
  },
  'resize-nesw': {
    d: 'M6.8 25.2 L7.2 17.1 L10 19.9 L19.9 10 L17.1 7.2 L25.2 6.8 L24.8 14.9 L22 12.1 L12.1 22 L14.9 24.8 Z',
    hotspot: CENTER
  },
  help: {
    d: `${SMALL_ARROW} M19 17 Q19 14.5 22 14.5 Q25 14.5 25 17 Q25 19 23 20 Q22.5 20.5 22.5 22 H20.5 Q20.5 19.5 22 18.8 Q23 18.2 23 17.2 Q23 16.5 22 16.5 Q21 16.5 21 17.2 Z M20.5 23.5 H22.5 V25.5 H20.5 Z`,
    hotspot: TOP_LEFT
  }
}

export function cursorMatrix(shape: CursorShape, at: Point, heightPx: number): [number, number, number, number, number, number] {
  const scale = heightPx / ART_BOX
  const { hotspot } = CURSOR_ART[shape]
  return [scale, 0, 0, scale, at.x - hotspot.x * scale, at.y - hotspot.y * scale]
}

export function drawCursor(ctx: CanvasRenderingContext2D, frame: CursorFrame, look: CursorLook, heightPx: number, press: number): void {
  const { fill, outline } = LOOKS[look]
  ctx.save()
  ctx.globalAlpha = frame.opacity
  ctx.transform(...cursorMatrix(frame.shape, frame, heightPx * press))
  const path = new Path2D(CURSOR_ART[frame.shape].d)
  ctx.shadowColor = SHADOW.color
  ctx.shadowBlur = SHADOW.blur
  ctx.lineJoin = 'round'
  ctx.lineWidth = OUTLINE_WIDTH * 2
  ctx.strokeStyle = outline
  ctx.stroke(path)
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = fill
  ctx.fill(path)
  ctx.restore()
}
