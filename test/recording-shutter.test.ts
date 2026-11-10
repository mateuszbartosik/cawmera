import { describe, expect, it } from 'vitest'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { recordingLayout } from '../src/renderer/src/recording/layout'
import type { RecordingDoc } from '../src/renderer/src/recording/settings'
import { BLUR_LIMITS, cornerTravelPx, framePlan, sampleCount, shutterTimes } from '../src/renderer/src/recording/shutter'
import type { Matrix } from '../src/renderer/src/render/geometry'
import { movingCursorScene, output, piece, settings, still, stillScene, track, viewOf, withZooms, zoomIntoTheMiddle, zoomScene } from './recording-scenes'

const halfShutter = (0.5 * 1000) / 60 / 2

describe('shutterTimes', () => {
  it('spreads the shutter by blur strength', () => {
    expect(shutterTimes(1000, 60, 0, 8)).toEqual([1000])
    const ts = shutterTimes(1000, 60, 0.5, 3)
    expect(ts[0]).toBeCloseTo(1000 - 4.1667, 3)
    expect(ts[2]).toBeCloseTo(1000 + 4.1667, 3)
  })
})

describe('sampleCount', () => {
  it('counts samples so neighbours sit at most 2 px apart, up to the cap', () => {
    expect([sampleCount(0.2, 24), sampleCount(1, 24), sampleCount(10, 24), sampleCount(500, 24)]).toEqual([1, 2, 6, 24])
  })
})

describe('cornerTravelPx', () => {
  it('measures how far the picture’s corners travel', () => {
    const identity: Matrix = [1, 0, 0, 1, 0, 0]
    expect(cornerTravelPx(identity, identity, output)).toBe(0)
    expect(cornerTravelPx(identity, [1, 0, 0, 1, 10, 0], output)).toBe(10)
  })

  it('measures a zoom’s travel on screen, where the picture is seen', () => {
    const centredAt = (depth: number): Matrix => [depth, 0, 0, depth, 960 * (1 - depth), 540 * (1 - depth)]
    expect(cornerTravelPx(centredAt(2), centredAt(2.2), output)).toBeCloseTo(Math.hypot(96, 54), 9)
  })
})

describe('framePlan', () => {
  it('blurs only the cursor while it moves and the camera rests, with copies at most 2 px apart', () => {
    // a 1920 × 1080 take in a 1920 × 1080 output (layout scale 0.822); the cursor moves 3 video px per ms; Cursor blur 50% at 60 fps
    const plan = framePlan(movingCursorScene, 1000, 'export')
    expect(plan.camera).toBe(1)
    expect(plan.cursor).toBeGreaterThanOrEqual(11)
    expect(plan.cursor).toBeLessThanOrEqual(13)
    expect(framePlan(movingCursorScene, 1000, 'preview', 0.5).cursor).toBeLessThan(plan.cursor)
  })

  it('keeps one sample at 0% blur, however fast things move', () => {
    expect(framePlan({ ...zoomScene, settings: { ...zoomScene.settings, cameraBlur: 0, cursorBlur: 0 } }, 2700, 'export'))
      .toEqual({ camera: 1, cursor: 1 })
  })

  it('keeps blurring a camera still settling at a zoom’s start, and calls motion under about a quarter pixel either side rest', () => {
    const panning = { ...zoomScene, view: withZooms(viewOf(track), [{ start: 3000, end: 5000, depth: 2, focus: { x: 900, y: 500 } }]) }
    expect(framePlan(panning, 3000, 'export').camera).toBeGreaterThan(1)
    expect(framePlan(panning, 3500, 'export').camera).toBe(1)
    expect(framePlan(panning, 4000, 'export').camera).toBe(1)
  })

  it('keeps a cursor gliding to a stop sharp once it moves under about a quarter pixel either side', () => {
    const glideThenRest = { ...track, cursor: still.map((sample, i) => ({ ...sample, x: 400 + Math.min(i, 150) * 6 })) }
    const settling = { ...stillScene, view: withZooms(viewOf(glideThenRest), []) }
    expect(framePlan(settling, 2300, 'export').cursor).toBeGreaterThan(1)
    expect(framePlan(settling, 2800, 'export').cursor).toBe(1)
  })

  it('blurs a resting cursor while the camera carries it across the screen', () => {
    const offCentre = { ...track, cursor: still.map((sample) => ({ ...sample, x: 800, y: 500 })) }
    const carried = { ...stillScene, view: withZooms(viewOf(offCentre), [zoomIntoTheMiddle]) }
    expect(framePlan(carried, 2700, 'export').cursor).toBeGreaterThan(1)
  })

  it('counts a cursor that turns back within the shutter as moving, by its path rather than its ends', () => {
    const raw: RecordingDoc = { ...settings, smoothing: 0, hideWhenStill: false }
    const turnsAt3000 = { ...track, cursor: Array.from({ length: 801 }, (_, i) => ({ t: i * 8, x: 1000 + 3 * Math.min(Math.abs(i * 8 - 3000), 100), y: 720, shape: 'arrow' as const })) }
    const scene = { ...zoomScene, settings: raw, view: viewOf(turnsAt3000, null, raw) }
    const { scale } = recordingLayout(scene.view.frame, output, DEFAULT_HOUSE_STYLE)
    const travelThereAndBack = 2 * 3 * halfShutter * scale
    // its ends coincide; four points between them catch all but a fifth of the turn
    const { cursor } = framePlan(scene, 3000, 'export')
    expect(cursor).toBeGreaterThanOrEqual(sampleCount(0.8 * travelThereAndBack, BLUR_LIMITS.export.cursor))
    expect(cursor).toBeLessThanOrEqual(sampleCount(travelThereAndBack, BLUR_LIMITS.export.cursor))
  })

  it('keeps each frame’s shutter on its own side of a cut while the cursor moves on both sides of it', () => {
    const pxPerMs = 1.5
    const xAt = (t: number) => {
      if (t < 3000) return 800 + pxPerMs * Math.max(t - 2000, 0)
      if (t < 4000) return 2300 - 2 * (t - 3000)
      return 300 + pxPerMs * Math.min(t - 4000, 1000)
    }
    const jumpsWithTheCut = { ...track, cursor: still.map((sample) => ({ ...sample, x: xAt(sample.t) })) }
    const cut: RecordingDoc = { ...settings, hideWhenStill: false, pieces: [piece(0, 3000), piece(3000, 4000, true), piece(4000, 6400)] }
    const scene = { ...zoomScene, settings: cut, view: viewOf(jumpsWithTheCut, null, cut) }
    const { scale } = recordingLayout(scene.view.frame, output, DEFAULT_HOUSE_STYLE)
    const seam = 3000
    const movingBetween = (start: number, end: number) => ({ camera: 1, cursor: sampleCount(pxPerMs * (end - start) * scale, BLUR_LIMITS.export.cursor) })

    expect(framePlan(scene, 2996, 'export')).toEqual(movingBetween(2996 - halfShutter, seam))
    expect(framePlan(scene, seam, 'export')).toEqual(movingBetween(seam, seam + halfShutter))
    expect(framePlan(scene, 3004, 'export')).toEqual(movingBetween(seam, 3004 + halfShutter))
    expect(movingBetween(2996 - halfShutter, seam).cursor).toBe(5)
  })
})
