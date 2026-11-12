import { describe, expect, it } from 'vitest'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { recordingEditLayout } from '../src/renderer/src/recording/edit-layout'
import { recordingLayout } from '../src/renderer/src/recording/layout'
import { recordingScene } from '../src/renderer/src/recording/scene'
import { DEFAULT_RECORDING, type RecordingDoc } from '../src/renderer/src/recording/settings'
import { cameraMatrixAt, framePlan } from '../src/renderer/src/recording/shutter'
import { takeViewFor } from '../src/renderer/src/recording/take-view'
import { wholeTake } from '../src/renderer/src/recording/timemap'
import type { Click, RecordingTrack } from '../src/renderer/src/recording/track'
import { clicksCovered, ZOOM_DEPTH_RANGE, type ZoomEdit } from '../src/renderer/src/recording/zoom-edits'
import { aimedArea, areaGrabAt, areaOf, depthOf, draggedFraming, focusOf, moveArea, resizeArea } from '../src/renderer/src/recording/zoom-area'
import { sourceRectToOutput } from '../src/renderer/src/render/layout'
import { video, zoomScene } from './recording-scenes'

const frame = { width: 1920, height: 1080 }

describe('a zoom’s area', () => {
  it('is the part of the frame the zoom shows, inside the frame', () => {
    expect(areaOf({ x: 960, y: 540 }, 2, frame)).toEqual({ x: 480, y: 270, w: 960, h: 540 })
    expect(areaOf({ x: 10, y: 10 }, 2, frame)).toEqual({ x: 0, y: 0, w: 960, h: 540 })
  })
  it('turns an area back into focus and depth', () => {
    expect(focusOf({ x: 0, y: 0, w: 960, h: 540 })).toEqual({ x: 480, y: 270 })
    expect(depthOf({ x: 0, y: 0, w: 640, h: 360 }, frame)).toBe(3)
  })
  it('resizes from a corner with the frame’s shape, within the depth range', () => {
    const from = { x: 0, y: 0, w: 960, h: 540 }
    const bigger = resizeArea(from, 'se', 100, 0, frame, ZOOM_DEPTH_RANGE)
    expect(bigger.w).toBe(1060)
    expect(bigger.w / bigger.h).toBeCloseTo(1920 / 1080)
    expect(depthOf(resizeArea(from, 'se', -2000, 0, frame, ZOOM_DEPTH_RANGE), frame)).toBe(3)
    expect(depthOf(resizeArea(from, 'se', 5000, 0, frame, ZOOM_DEPTH_RANGE), frame)).toBeCloseTo(1.2)
  })
  it('moves without leaving the frame', () => expect(moveArea({ x: 480, y: 270, w: 960, h: 540 }, 2000, 0, frame).x).toBe(960))
  it('maps a cropped take’s video px onto the shot', () => {
    const layout = recordingEditLayout({ crop: { x: 0, y: 120, w: 1920, h: 960 }, frame: { width: 1920, height: 960 } }, frame, frame, DEFAULT_HOUSE_STYLE)
    expect(sourceRectToOutput(layout, { x: 0, y: 120, w: 1920, h: 960 }))
      .toEqual(recordingLayout({ width: 1920, height: 960 }, frame, DEFAULT_HOUSE_STYLE).content)
  })

  it('keeps the corner opposite the dragged one where it was', () => {
    const middle = { x: 480, y: 270, w: 960, h: 540 }
    const smaller = resizeArea(middle, 'nw', 320, 0, frame, ZOOM_DEPTH_RANGE)
    expect(smaller.x + smaller.w).toBe(1440)
    expect(smaller.y + smaller.h).toBe(810)
    expect(smaller.w).toBe(640)
    const taller = resizeArea(middle, 'ne', 0, -90, frame, ZOOM_DEPTH_RANGE)
    expect(taller.x).toBe(480)
    expect(taller.y + taller.h).toBe(810)
    expect(taller.h).toBe(630)
  })
  it('follows the axis the pointer travels further along, for its size', () => {
    const from = { x: 0, y: 0, w: 960, h: 540 }
    expect(resizeArea(from, 'se', 100, 90, frame, ZOOM_DEPTH_RANGE).h).toBe(630)
    expect(resizeArea(from, 'se', 200, 90, frame, ZOOM_DEPTH_RANGE).w).toBe(1160)
  })
  it('grows only as far as the frame lets the fixed corner', () => {
    const nearTheRight = { x: 1000, y: 100, w: 800, h: 450 }
    const grown = resizeArea(nearTheRight, 'se', 600, 0, frame, ZOOM_DEPTH_RANGE)
    expect(grown.x).toBe(1000)
    expect(grown.x + grown.w).toBe(1920)
    expect(grown.y + grown.h).toBeLessThanOrEqual(1080)
  })

  it('is grabbed by a corner near it, or anywhere inside to move it', () => {
    const area = { x: 100, y: 100, w: 400, h: 225 }
    expect(areaGrabAt(area, { x: 104, y: 97 }, 8)).toBe('nw')
    expect(areaGrabAt(area, { x: 500, y: 325 }, 8)).toBe('se')
    expect(areaGrabAt(area, { x: 300, y: 200 }, 8)).toBe('move')
    expect(areaGrabAt(area, { x: 90, y: 200 }, 8)).toBeNull()
  })

  it('frames a zoom where its area was dragged, in video px, with a depth only for a corner', () => {
    const view = { crop: { x: 100, y: 50, w: 1600, h: 900 }, frame: { width: 1600, height: 900 } }
    const start = { x: 0, y: 0, w: 800, h: 450 }
    expect(draggedFraming(start, 'move', 100, 50, view)).toEqual({ focus: { x: 600, y: 325 } })
    const resized = draggedFraming(start, 'se', 160, 0, view)
    expect(resized.focus).toEqual({ x: 580, y: 320 })
    expect(resized.depth).toBeCloseTo(1600 / 960)
  })
})

const click = (t: number, x: number, y: number): Click => ({ t, x, y, button: 'left', up: t + 80 })
const take: RecordingTrack = {
  kind: 'monitor',
  width: 1920,
  height: 1080,
  fps: 60,
  durationMs: 10_000,
  scale: 1,
  cursor: [{ t: 0, x: 960, y: 540, shape: 'arrow' }],
  clicks: [click(2500, 300, 300), click(5000, 1500, 800)]
}
const entry = { id: 'area-take', name: 'Take', poster: null, track: take }
const recordingWith = (zoom: ZoomEdit): RecordingDoc =>
  ({ ...DEFAULT_RECORDING, smoothing: 0, trim: { start: 0, end: 10_000 }, pieces: wholeTake(10_000), zooms: [zoom] })

describe('the area a selected zoom shows', () => {
  const deep: ZoomEdit = { id: 'deep', start: 2000, end: 8000, depth: 3, aim: 'auto', focus: { x: 960, y: 540 } }
  const view = takeViewFor(entry, recordingWith(deep), null)
  const covered = clicksCovered(deep, view, 'calm')

  it('is an Auto zoom’s group of clicks at the playhead while it holds', () => {
    expect(covered.map((c) => c.t)).toEqual([2500, 5000])
    const first = aimedArea(deep, covered, view, 3000)
    expect(first.clicks.map((c) => c.t)).toEqual([2500])
    expect(first.area).toEqual({ x: 0, y: 120, w: 640, h: 360 })
    const second = aimedArea(deep, covered, view, 6000)
    expect(second.clicks.map((c) => c.t)).toEqual([5000])
    expect(second.area).toEqual({ x: 1180, y: 620, w: 640, h: 360 })
  })
  it('is its first group otherwise', () => {
    expect(aimedArea(deep, covered, view, 1000).clicks.map((c) => c.t)).toEqual([2500])
    expect(aimedArea(deep, covered, view, 9000).clicks.map((c) => c.t)).toEqual([2500])
  })
  it('is a Manual zoom’s focus, with every click it covers', () => {
    const manual: ZoomEdit = { ...deep, aim: 'manual', depth: 2, focus: { x: 900, y: 500 } }
    const cropped = takeViewFor(entry, recordingWith(manual), { x: 100, y: 50, w: 1600, h: 900 })
    const shown = aimedArea(manual, clicksCovered(manual, cropped, 'calm'), cropped, 6000)
    expect(shown.area).toEqual({ x: 400, y: 225, w: 800, h: 450 })
    expect(shown.clicks.map((c) => c.t)).toEqual([2500, 5000])
  })
  it('is the focus of an Auto zoom that covers no clicks', () => {
    const empty: ZoomEdit = { ...deep, start: 6000, end: 8000, depth: 2 }
    const emptyView = takeViewFor(entry, recordingWith(empty), null)
    expect(aimedArea(empty, [], emptyView, 7000)).toEqual({ area: { x: 480, y: 270, w: 960, h: 540 }, clicks: [] })
  })
})

describe('the wide edit view', () => {
  it('shows the whole frame, unmoved and unblurred by the camera, only when asked', () => {
    const wide = { ...zoomScene, wide: true }
    expect(cameraMatrixAt(zoomScene, 4000)).not.toEqual([1, 0, 0, 1, 0, 0])
    expect(cameraMatrixAt(wide, 4000)).toEqual([1, 0, 0, 1, 0, 0])
    expect(framePlan(zoomScene, 2700, 'preview').camera).toBeGreaterThan(1)
    expect(framePlan(wide, 2700, 'preview').camera).toBe(1)
  })
  it('is never what the export draws', () => {
    const doc = { ...DEFAULT_DOC, sourceId: entry.id, recording: recordingWith({ id: 'z', start: 2000, end: 8000, depth: 2, aim: 'manual', focus: { x: 960, y: 540 } }) }
    expect(recordingScene(entry, doc, DEFAULT_HOUSE_STYLE, null, video)!.wide).toBe(false)
    expect(recordingScene(entry, doc, DEFAULT_HOUSE_STYLE, null, video, true)!.wide).toBe(true)
  })
})
