import { describe, expect, it } from 'vitest'
import { buildCameraPath, cameraAt, cameraTargets, ZOOM_TRANSITION_MS, type ZoomSpeed } from '../src/renderer/src/recording/camera'
import { autoZooms, ZOOM_RULES, type ZoomSegment } from '../src/renderer/src/recording/zooms'

const frame = { width: 1920, height: 1080 }
const click = (t: number, x: number, y: number, button: 'left' | 'right' = 'left') => ({ t, x, y, button, up: t + 80 })
const whole = (durationMs: number) => ({ start: 0, end: durationMs })
const cameraFor = (zooms: ZoomSegment[], speed: ZoomSpeed) => buildCameraPath(cameraTargets(zooms, frame, speed), speed, frame)

describe('autoZooms', () => {
  it('makes no zooms without clicks', () => expect(autoZooms([], frame, whole(10_000), 'calm')).toEqual([]))

  it('ignores right clicks and clicks outside the frame', () => {
    expect(autoZooms([click(3000, 100, 100, 'right'), click(4000, -5, 100), click(5000, 100, 2000)], frame, whole(10_000), 'calm')).toEqual([])
  })

  it('groups clicks within 3 s and holds 1.5 s after the last', () => {
    const zooms = autoZooms([click(3000, 900, 500), click(5000, 1000, 560)], frame, whole(20_000), 'calm')
    expect(zooms).toHaveLength(1)
    expect(zooms[0].start).toBe(2900)
    expect(zooms[0].end).toBe(6500)
  })

  it('starts a new zoom after a gap over 3 s', () => {
    expect(autoZooms([click(3000, 900, 500), click(6100, 900, 500)], frame, whole(20_000), 'calm')).toHaveLength(2)
  })

  it('picks the deepest depth up to 2.5× that keeps the clicks in view', () => {
    expect(autoZooms([click(3000, 960, 540)], frame, whole(20_000), 'calm')[0].depth).toBe(2.5)
    const wide = autoZooms([click(3000, 300, 540), click(3500, 1300, 540)], frame, whole(20_000), 'calm')[0]
    expect(wide.depth).toBeGreaterThanOrEqual(1.25)
    expect(wide.depth).toBeLessThan(2.5)
  })

  it('keeps the zoomed view inside the frame', () => {
    const z = autoZooms([click(3000, 5, 5)], frame, whole(20_000), 'calm')[0]
    expect(z.focus.x).toBeCloseTo(1920 / (2 * z.depth))
    expect(z.focus.y).toBeCloseTo(1080 / (2 * z.depth))
  })

  it.each(['calm', 'quick'] as const)('keeps the first and last second of the trimmed video wide, transitions included (%s)', (speed) => {
    const trim = { start: 2000, end: 7000 }
    const zooms = autoZooms([click(2400, 900, 500), click(5000, 900, 500)], frame, trim, speed)
    const edgeMs = ZOOM_RULES.wideEdgeMs + ZOOM_TRANSITION_MS[speed]
    expect(zooms).toHaveLength(1)
    expect(zooms[0].start).toBe(trim.start + edgeMs)
    expect(zooms[0].end).toBe(trim.end - edgeMs)
    const camera = cameraFor(zooms, speed)
    for (let t = trim.start; t <= trim.start + ZOOM_RULES.wideEdgeMs; t += 5) expect(cameraAt(camera, t).depth).toBe(1)
    // The zoom-out starts from the tail of the zoom-in, so one settle time into it the camera is 2% out, give or take a hair.
    const twoPercentOfTheMoveOut = 1.001 * 0.02 * Math.log(zooms[0].depth)
    for (let t = trim.end - ZOOM_RULES.wideEdgeMs; t <= trim.end; t += 5) {
      expect(Math.log(cameraAt(camera, t).depth)).toBeLessThanOrEqual(twoPercentOfTheMoveOut)
    }
  })

  it('counts only the clicks inside the trim', () => {
    const cutClick = click(2800, 100, 100)
    const shownClick = click(5000, 600, 400)
    expect(autoZooms([cutClick, shownClick], frame, { start: 3000, end: 12_000 }, 'calm')).toEqual([
      { start: 4900, end: 6500, depth: 2.5, focus: { x: 600, y: 400 } }
    ])
  })

  it('drops a zoom squeezed under 600 ms by the wide edges', () => {
    expect(autoZooms([click(9400, 900, 500)], frame, whole(10_000), 'calm')).toEqual([])
    expect(autoZooms([click(9400, 900, 500)], frame, whole(10_000), 'quick')).toEqual([])
  })

  it('makes no zooms in a trim too short to hold one between its wide edges', () => {
    expect(autoZooms([click(1500, 900, 500)], frame, whole(3000), 'calm')).toEqual([])
    expect(autoZooms([click(1500, 900, 500)], frame, whole(3000), 'quick')).toEqual([])
  })

  it('meets overlapping zooms that cannot merge at the midpoint between their clicks', () => {
    const zooms = autoZooms([click(3000, 100, 100), click(4000, 1800, 1000)], frame, whole(20_000), 'calm')
    expect(zooms).toHaveLength(2)
    expect(zooms[0].end).toBe(3500)
    expect(zooms[1].start).toBe(3500)
  })

  it('keeps the meeting point inside both zooms and drops a zoom left too short', () => {
    const edgeAtOneSecond = { ...ZOOM_RULES, wideEdgeMs: 1000 - ZOOM_TRANSITION_MS.calm }
    const zooms = autoZooms([click(300, 100, 100), click(900, 1800, 1000)], frame, whole(10_000), 'calm', edgeAtOneSecond)
    expect(zooms).toEqual([{ start: 1000, end: 2400, depth: 2.5, focus: { x: 1536, y: 864 } }])
    const camera = cameraFor(zooms, 'calm')
    let previous = cameraAt(camera, 0)
    for (let t = 1; t <= 4000; t++) {
      const current = cameraAt(camera, t)
      expect(Math.abs(current.depth - previous.depth)).toBeLessThan(0.05)
      expect(Math.hypot(current.focus.x - previous.focus.x, current.focus.y - previous.focus.y)).toBeLessThan(40)
      previous = current
    }
  })

  it('merges overlapping zooms whose clicks all fit at the minimum depth', () => {
    const rules = { ...ZOOM_RULES, groupGapMs: 1000 }
    const zooms = autoZooms([click(3000, 300, 540), click(4200, 1300, 540)], frame, whole(20_000), 'calm', rules)
    expect(zooms).toHaveLength(1)
    expect(zooms[0].start).toBe(2900)
    expect(zooms[0].end).toBe(5700)
    expect(zooms[0].depth).toBeCloseTo(1920 / (1000 + 2 * 0.1 * 1920))
    expect(zooms[0].focus.x).toBeCloseTo(800)
    expect(zooms[0].focus.y).toBeCloseTo(540)
  })
})
