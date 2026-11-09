import { clamp, type Point, type Size } from '../render/geometry'
import { firstIndexWhere } from './binary-search'
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

interface Axis { value: number; velocity: number }
/** From `at` on, each axis (ln depth, focus x, focus y) springs from `from` towards `goal`. */
interface Knot { at: number; from: Axis[]; goal: number[] }
export interface CameraPath { knots: Knot[]; spring: Spring; frame: Size }

const wideOf = (frame: Size): CameraState => ({ depth: 1, focus: { x: frame.width / 2, y: frame.height / 2 } })
const stateOf = ({ depth, focus }: ZoomSegment): CameraState => ({ depth, focus })
const axesOf = ({ depth, focus }: CameraState): number[] => [Math.log(depth), focus.x, focus.y]

/** The nearest focus that keeps a view of the frame at this depth inside the frame. */
export function clampFocus(point: Point, depth: number, frame: Size): Point {
  const halfViewX = frame.width / (2 * depth)
  const halfViewY = frame.height / (2 * depth)
  return { x: clamp(point.x, halfViewX, frame.width - halfViewX), y: clamp(point.y, halfViewY, frame.height - halfViewY) }
}

/** Where the camera heads, and from when. It heads for a zoom one settle time early, so the zoom is in when it starts. */
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

function movedFrom(knot: Knot, spring: Spring, dtMs: number): Axis[] {
  return knot.from.map(({ value, velocity }, axis) => {
    const [nextValue, nextVelocity] = springStep(value, velocity, knot.goal[axis], spring, dtMs)
    return { value: nextValue, velocity: nextVelocity }
  })
}

/** Starts wide and at rest. At each target the camera keeps its place and velocity and springs towards the new goal. */
export function buildCameraPath(targets: CameraTarget[], speed: ZoomSpeed, frame: Size): CameraPath {
  const { settleMs, damping } = CAMERA_MOTION[speed]
  const spring = springFor(settleMs, damping)
  const atRest = axesOf(wideOf(frame)).map((value) => ({ value, velocity: 0 }))
  const knots: Knot[] = []
  for (const { at, state } of [...targets].sort((a, b) => a.at - b.at)) {
    const previous = knots.at(-1)
    knots.push({ at, from: previous ? movedFrom(previous, spring, at - previous.at) : atRest, goal: axesOf(state) })
  }
  return { knots, spring, frame }
}

/** Never wider than the whole frame, and never showing past its edges. */
export function cameraAt(path: CameraPath, t: number): CameraState {
  const { knots, spring, frame } = path
  const index = firstIndexWhere(knots.length, (i) => knots[i].at > t) - 1
  if (index < 0) return wideOf(frame)
  const [logDepth, x, y] = movedFrom(knots[index], spring, t - knots[index].at).map(({ value }) => value)
  const depth = Math.max(1, Math.exp(logDepth))
  return { depth, focus: clampFocus({ x, y }, depth, frame) }
}
