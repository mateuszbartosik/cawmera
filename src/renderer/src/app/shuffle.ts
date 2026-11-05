import { angleDistance, edgeDirections, EDGES, MIN_ANGLE_APART, type Doc, type Edge } from './doc'
import type { HouseStyle } from './house-style'
import type { Rect, Size } from '../render/geometry'
import { baseSelection, capacity, effectiveSelection, resolveEdge, scaleFor } from '../render/layout'

export interface Look {
  edge: Edge | null
  angle: number
}

const pick = <T>(items: T[], random: () => number): T => items[Math.min(items.length - 1, Math.floor(random() * items.length))]

const near = (a: number, b: number) => Math.abs(a - b) < 0.5

/** Every end of the screenshot that showed before still shows: a whole side stays whole, a cut one keeps its end. */
function keepsShownPart(base: Rect, before: Rect, after: Rect): boolean {
  const axis = (start: number, length: number, from: number, fromLength: number, to: number, toLength: number) => {
    const startKept = !near(from, start) || near(to, start)
    const endKept = !near(from + fromLength, start + length) || near(to + toLength, start + length)
    return startKept && endKept
  }
  return axis(base.x, base.w, before.x, before.w, after.x, after.w) && axis(base.y, base.h, before.y, before.h, after.y, after.h)
}

function nextFrame(doc: Doc, image: Size, style: HouseStyle, random: () => number): { edge: Edge | null; used: Edge } {
  const scale = scaleFor(doc.capturedAt, doc.zoom, style)
  const shown = (edge: Edge) => effectiveSelection(doc.crop, image, capacity(scale, style, edge, doc.size), edge)
  const current = resolveEdge(doc.edge, doc.crop, image, scale, style, doc.size)
  const base = baseSelection(doc.crop, image)
  const before = shown(current)
  const options = EDGES.filter((edge) => edge !== current && keepsShownPart(base, before, shown(edge)))
  if (options.length === 0) return { edge: doc.edge, used: current }
  const edge = pick(options, random)
  return { edge, used: edge }
}

/** Light from the side the frame leaves open, so the glow never sits behind the screenshot. */
function nextAngle(angle: number, frame: Edge, random: () => number): number {
  const { x, y } = edgeDirections(frame)
  const open = (a: number) => {
    const rad = (a * Math.PI) / 180
    return Math.sin(rad) * x - Math.cos(rad) * y <= 1e-9
  }
  const apart = Array.from({ length: 360 }, (_, a) => a).filter((a) => angleDistance(a, angle) >= MIN_ANGLE_APART)
  const lit = apart.filter(open)
  return pick(lit.length > 0 ? lit : apart, random)
}

/** A new edge and light direction for one shot, keeping the part of the screenshot that shows. */
export function shuffledLook(doc: Doc, image: Size | null, style: HouseStyle, random: () => number = Math.random): Look {
  const frame = image ? nextFrame(doc, image, style, random) : null
  const edge = frame ? frame.edge : doc.edge
  const angle = doc.fill === 'image' ? doc.angle : nextAngle(doc.angle, frame?.used ?? 'c', random)
  return { edge, angle }
}
