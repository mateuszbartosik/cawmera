import { clamp, type Point, type Size } from '../render/geometry'
import { clampFocus, ZOOM_TRANSITION_MS, type ZoomSpeed } from './camera'
import type { Span } from './timemap'
import { isShownClick, type Click } from './track'
import type { Trim } from './trim'

/**
 * The camera is fully zoomed in from `start` to `end` (output ms), on `focus` and then on each `follow` focus by its `at`.
 * Moving into and out of the zoom happens outside this window.
 */
export interface ZoomSegment { start: number; end: number; depth: number; focus: Point; follow?: { at: number; focus: Point }[] }

export const ZOOM_RULES = {
  groupGapMs: 3000,
  preClickMs: 100,
  holdMs: 1500,
  wideEdgeMs: 1000,
  minDepth: 1.25,
  maxDepth: 2.5,
  marginShare: 0.1,
  minHoldMs: 600
}

/** Lets clicks fit at the depth their own padded box gives, which rounding can put a hair too deep. */
const FIT_TOLERANCE = 1e-9

type ZoomRules = typeof ZOOM_RULES

interface Box { left: number; top: number; right: number; bottom: number }
export interface ClickedZoom extends ZoomSegment { clicks: Click[] }

function paddedBoxAround(clicks: Click[], frame: Size, rules: ZoomRules): Box {
  const marginX = rules.marginShare * frame.width
  const marginY = rules.marginShare * frame.height
  return {
    left: Math.min(...clicks.map((c) => c.x)) - marginX,
    right: Math.max(...clicks.map((c) => c.x)) + marginX,
    top: Math.min(...clicks.map((c) => c.y)) - marginY,
    bottom: Math.max(...clicks.map((c) => c.y)) + marginY
  }
}

const centreOf = (box: Box): Point => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 })

function fitsAtDepth(clicks: Click[], frame: Size, depth: number, rules: ZoomRules): boolean {
  const box = paddedBoxAround(clicks, frame, rules)
  return box.right - box.left <= frame.width / depth && box.bottom - box.top <= frame.height / depth
}

export function focusOn(clicks: Click[], frame: Size, depth: number, rules = ZOOM_RULES): Point {
  return clampFocus(centreOf(paddedBoxAround(clicks, frame, rules)), depth, frame)
}

export function clickGroupsAtDepth(clicks: Click[], frame: Size, depth: number, rules = ZOOM_RULES): Click[][] {
  const forgivingDepth = depth / (1 + FIT_TOLERANCE)
  const groups: Click[][] = []
  for (const click of clicks) {
    const group = groups[groups.length - 1]
    if (group !== undefined && fitsAtDepth([...group, click], frame, forgivingDepth, rules)) group.push(click)
    else groups.push([click])
  }
  return groups
}

function groupClicks(clicks: Click[], frame: Size, rules: ZoomRules): Click[][] {
  const groups: Click[][] = []
  for (const click of clicks) {
    const group = groups[groups.length - 1]
    const joins = group !== undefined
      && click.t - group[group.length - 1].t <= rules.groupGapMs
      && fitsAtDepth([...group, click], frame, rules.minDepth, rules)
    if (joins) group.push(click)
    else groups.push([click])
  }
  return groups
}

function zoomAround(clicks: Click[], frame: Size, holdLimits: Span, rules: ZoomRules): ClickedZoom {
  const box = paddedBoxAround(clicks, frame, rules)
  const depth = Math.min(rules.maxDepth, frame.width / (box.right - box.left), frame.height / (box.bottom - box.top))
  return {
    clicks,
    depth,
    focus: clampFocus(centreOf(box), depth, frame),
    start: clamp(clicks[0].t - rules.preClickMs, holdLimits.start, holdLimits.end),
    end: clamp(clicks[clicks.length - 1].t + rules.holdMs, holdLimits.start, holdLimits.end)
  }
}

function resolveOverlaps(zooms: ClickedZoom[], frame: Size, holdLimits: Span, rules: ZoomRules): ClickedZoom[] {
  const resolved: ClickedZoom[] = []
  for (let zoom of zooms) {
    for (;;) {
      const previous = resolved[resolved.length - 1]
      if (previous === undefined || zoom.start >= previous.end) break
      const allClicks = [...previous.clicks, ...zoom.clicks]
      if (!fitsAtDepth(allClicks, frame, rules.minDepth, rules)) {
        const midpointMs = (previous.clicks[previous.clicks.length - 1].t + zoom.clicks[0].t) / 2
        const meetingMs = clamp(midpointMs, previous.start, zoom.end)
        previous.end = meetingMs
        zoom.start = meetingMs
        break
      }
      resolved.pop()
      zoom = zoomAround(allClicks, frame, holdLimits, rules)
    }
    resolved.push(zoom)
  }
  return resolved
}

export function autoHoldLimits(trim: Trim, speed: ZoomSpeed, rules = ZOOM_RULES): Span {
  const wideAndTransitionMs = rules.wideEdgeMs + ZOOM_TRANSITION_MS[speed]
  return { start: trim.start + wideAndTransitionMs, end: trim.end - wideAndTransitionMs }
}

export function autoZoomsWithClicks(clicks: Click[], frame: Size, trim: Trim, speed: ZoomSpeed, rules = ZOOM_RULES): ClickedZoom[] {
  const holdLimits = autoHoldLimits(trim, speed, rules)
  const shownClicks = clicks.filter((click) => isShownClick(click, frame) && click.t >= trim.start && click.t <= trim.end)
  const holdsLongEnough = (zoom: ZoomSegment) => zoom.end - zoom.start >= rules.minHoldMs
  const zooms = groupClicks(shownClicks, frame, rules)
    .map((group) => zoomAround(group, frame, holdLimits, rules))
    .filter(holdsLongEnough)
  return resolveOverlaps(zooms, frame, holdLimits, rules).filter(holdsLongEnough)
}

export function autoZooms(clicks: Click[], frame: Size, trim: Trim, speed: ZoomSpeed, rules = ZOOM_RULES): ZoomSegment[] {
  return autoZoomsWithClicks(clicks, frame, trim, speed, rules).map(({ start, end, depth, focus }) => ({ start, end, depth, focus }))
}
