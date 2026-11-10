import { clamp, type Matrix, type Point, type Size } from '../render/geometry'
import { firstIndexWhere } from './binary-search'
import { toComposition, type RecordingLayout } from './layout'
import { springFor, springStep, type Spring } from './spring'
import type { ZoomSegment } from './zooms'

export type ZoomSpeed = 'calm' | 'quick'
export interface CameraState { depth: number; focus: Point }
export interface CameraTarget { at: number; state: CameraState }

export const CAMERA_MOTION: Record<ZoomSpeed, { settleMs: number; damping: number }> = {
  calm: { settleMs: 900, damping: 1 },
  quick: { settleMs: 500, damping: 0.8 }
}
export const ZOOM_TRANSITION_MS: Record<ZoomSpeed, number> = { calm: CAMERA_MOTION.calm.settleMs, quick: CAMERA_MOTION.quick.settleMs }

const STAY_WIDE_EXTRA_GAP_MS = 300
const CRITICALLY_DAMPED = 1

interface Axis { value: number; velocity: number }
interface Knot { at: number; from: Axis[]; goal: number[]; spring: Spring }
export interface CameraPath { knots: Knot[]; frame: Size }

const wideOf = (frame: Size): CameraState => ({ depth: 1, focus: { x: frame.width / 2, y: frame.height / 2 } })
const stateOf = ({ depth, focus }: ZoomSegment): CameraState => ({ depth, focus })
const axesOf = ({ depth, focus }: CameraState): number[] => [Math.log(depth), focus.x, focus.y]

/** The nearest focus that keeps a view of the frame at this depth inside the frame. */
export function clampFocus(point: Point, depth: number, frame: Size): Point {
  const halfViewX = frame.width / (2 * depth)
  const halfViewY = frame.height / (2 * depth)
  return { x: clamp(point.x, halfViewX, frame.width - halfViewX), y: clamp(point.y, halfViewY, frame.height - halfViewY) }
}

export function cameraTargets(zooms: ZoomSegment[], frame: Size, speed: ZoomSpeed): CameraTarget[] {
  const lead = ZOOM_TRANSITION_MS[speed]
  const wide = wideOf(frame)
  const targets: CameraTarget[] = []
  zooms.forEach((zoom, i) => {
    const previous = zooms[i - 1]
    const enter = zoom.start - lead
    if (previous && enter - previous.end < lead + STAY_WIDE_EXTRA_GAP_MS) {
      targets.push({ at: Math.max(enter, (previous.start + previous.end) / 2), state: stateOf(zoom) })
      return
    }
    if (previous) targets.push({ at: previous.end, state: wide })
    targets.push({ at: enter, state: stateOf(zoom) })
  })
  const last = zooms.at(-1)
  if (last) targets.push({ at: last.end, state: wide })
  return targets
}

function movedFrom(knot: Knot, dtMs: number): Axis[] {
  return knot.from.map(({ value, velocity }, axis) => {
    const [nextValue, nextVelocity] = springStep(value, velocity, knot.goal[axis], knot.spring, dtMs)
    return { value: nextValue, velocity: nextVelocity }
  })
}

export function buildCameraPath(targets: CameraTarget[], speed: ZoomSpeed, frame: Size): CameraPath {
  const { settleMs, damping } = CAMERA_MOTION[speed]
  const intoZoom = springFor(settleMs, damping)
  // An overshooting zoom-out would hit the 1× floor at speed and stop dead.
  const outToWide = springFor(settleMs, CRITICALLY_DAMPED)
  const atRest = axesOf(wideOf(frame)).map((value) => ({ value, velocity: 0 }))
  const knots: Knot[] = []
  for (const { at, state } of [...targets].sort((a, b) => a.at - b.at)) {
    const previous = knots.at(-1)
    const from = previous ? movedFrom(previous, at - previous.at) : atRest
    knots.push({ at, from, goal: axesOf(state), spring: state.depth > 1 ? intoZoom : outToWide })
  }
  return { knots, frame }
}

export function cameraAt(path: CameraPath, t: number): CameraState {
  const { knots, frame } = path
  const index = firstIndexWhere(knots.length, (i) => knots[i].at > t) - 1
  if (index < 0) return wideOf(frame)
  const [logDepth, x, y] = movedFrom(knots[index], t - knots[index].at).map(({ value }) => value)
  const depth = Math.max(1, Math.exp(logDepth))
  return { depth, focus: clampFocus({ x, y }, depth, frame) }
}

/** From composition px to output px, as the camera shows them. */
export function viewMatrix(camera: CameraState, layout: RecordingLayout, output: Size): Matrix {
  const s = camera.depth
  const focus = toComposition(layout, camera.focus)
  const px = clamp(focus.x, output.width / (2 * s), output.width - output.width / (2 * s))
  const py = clamp(focus.y, output.height / (2 * s), output.height - output.height / (2 * s))
  return [s, 0, 0, s, output.width / 2 - px * s, output.height / 2 - py * s]
}
