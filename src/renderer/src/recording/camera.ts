import type { Point, Size } from '../render/geometry'
import type { ZoomSegment } from './zooms'

export type ZoomSpeed = 'calm' | 'quick'
export const ZOOM_TRANSITION_MS: Record<ZoomSpeed, number> = { calm: 700, quick: 400 }
export interface CameraState { depth: number; focus: Point }

const STAY_WIDE_EXTRA_GAP_MS = 300

interface Transition { from: CameraState; to: CameraState; start: number; end: number }

export function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

const lerp = (a: number, b: number, e: number) => a + (b - a) * e

function blend(from: CameraState, to: CameraState, progress: number): CameraState {
  const e = easeInOutCubic(progress)
  return {
    depth: Math.exp(lerp(Math.log(from.depth), Math.log(to.depth), e)),
    focus: { x: lerp(from.focus.x, to.focus.x, e), y: lerp(from.focus.y, to.focus.y, e) }
  }
}

const stateOf = (zoom: ZoomSegment): CameraState => ({ depth: zoom.depth, focus: zoom.focus })

function transitionsBetween(zooms: ZoomSegment[], wide: CameraState, transitionMs: number): Transition[] {
  const transitions: Transition[] = []
  const first = zooms[0]
  transitions.push({ from: wide, to: stateOf(first), start: first.start - transitionMs, end: first.start })
  zooms.forEach((a, i) => {
    const b = zooms[i + 1]
    if (!b) {
      transitions.push({ from: stateOf(a), to: wide, start: a.end, end: a.end + transitionMs })
      return
    }
    const gap = b.start - a.end
    if (gap >= 2 * transitionMs + STAY_WIDE_EXTRA_GAP_MS) {
      transitions.push({ from: stateOf(a), to: wide, start: a.end, end: a.end + transitionMs })
      transitions.push({ from: wide, to: stateOf(b), start: b.start - transitionMs, end: b.start })
      return
    }
    const duration = Math.max(gap, transitionMs)
    const middle = a.end + gap / 2
    transitions.push({ from: stateOf(a), to: stateOf(b), start: middle - duration / 2, end: middle + duration / 2 })
  })
  return transitions
}

export function cameraAt(t: number, zooms: ZoomSegment[], frame: Size, speed: ZoomSpeed): CameraState {
  const wide: CameraState = { depth: 1, focus: { x: frame.width / 2, y: frame.height / 2 } }
  if (zooms.length === 0) return wide

  const transition = transitionsBetween(zooms, wide, ZOOM_TRANSITION_MS[speed])
    .find(candidate => t >= candidate.start && t <= candidate.end)
  if (transition) return blend(transition.from, transition.to, (t - transition.start) / (transition.end - transition.start))

  const held = zooms.find(zoom => t >= zoom.start && t <= zoom.end)
  return held ? stateOf(held) : wide
}
