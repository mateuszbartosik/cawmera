import { clamp, type Point, type Size } from '../render/geometry'
import { ZOOM_TRANSITION_MS, type ZoomSpeed } from './camera'
import { isShownClick, type Click } from './track'
import type { Trim } from './trim'

/** The camera is fully zoomed in from `start` to `end` (source ms). Transitions happen outside this window. */
export interface ZoomSegment { start: number; end: number; depth: number; focus: Point }

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

type ZoomRules = typeof ZOOM_RULES

interface Box { left: number; top: number; right: number; bottom: number }
interface Span { start: number; end: number }
interface ClickedZoom extends ZoomSegment { clicks: Click[] }

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

function fitsAtMinDepth(clicks: Click[], frame: Size, rules: ZoomRules): boolean {
  const box = paddedBoxAround(clicks, frame, rules)
  return box.right - box.left <= frame.width / rules.minDepth && box.bottom - box.top <= frame.height / rules.minDepth
}

function groupClicks(clicks: Click[], frame: Size, rules: ZoomRules): Click[][] {
  const groups: Click[][] = []
  for (const click of clicks) {
    const group = groups[groups.length - 1]
    const joins = group !== undefined
      && click.t - group[group.length - 1].t <= rules.groupGapMs
      && fitsAtMinDepth([...group, click], frame, rules)
    if (joins) group.push(click)
    else groups.push([click])
  }
  return groups
}

function zoomAround(clicks: Click[], frame: Size, holdLimits: Span, rules: ZoomRules): ClickedZoom {
  const box = paddedBoxAround(clicks, frame, rules)
  const depth = Math.min(rules.maxDepth, frame.width / (box.right - box.left), frame.height / (box.bottom - box.top))
  const halfViewX = frame.width / (2 * depth)
  const halfViewY = frame.height / (2 * depth)
  return {
    clicks,
    depth,
    focus: {
      x: clamp((box.left + box.right) / 2, halfViewX, frame.width - halfViewX),
      y: clamp((box.top + box.bottom) / 2, halfViewY, frame.height - halfViewY)
    },
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
      if (!fitsAtMinDepth(allClicks, frame, rules)) {
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

export function autoZooms(clicks: Click[], frame: Size, trim: Trim, speed: ZoomSpeed, rules = ZOOM_RULES): ZoomSegment[] {
  const wideAndTransitionMs = rules.wideEdgeMs + ZOOM_TRANSITION_MS[speed]
  const holdLimits = { start: trim.start + wideAndTransitionMs, end: trim.end - wideAndTransitionMs }
  const shownClicks = clicks.filter((click) => isShownClick(click, frame) && click.t >= trim.start && click.t <= trim.end)
  const holdsLongEnough = (zoom: ZoomSegment) => zoom.end - zoom.start >= rules.minHoldMs
  const zooms = groupClicks(shownClicks, frame, rules)
    .map((group) => zoomAround(group, frame, holdLimits, rules))
    .filter(holdsLongEnough)
  return resolveOverlaps(zooms, frame, holdLimits, rules)
    .filter(holdsLongEnough)
    .map(({ start, end, depth, focus }) => ({ start, end, depth, focus }))
}
