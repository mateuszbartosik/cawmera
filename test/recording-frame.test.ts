import { describe, expect, it, vi } from 'vitest'
import * as cursorArt from '../src/renderer/src/recording/cursor-art'
import * as effects from '../src/renderer/src/recording/effects'
import { recordingLayout } from '../src/renderer/src/recording/layout'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import {
  cameraMatrixAt,
  cornerTravelPx,
  drawRecordingFrame,
  framePlan,
  sampleCount,
  shutterTimes,
  viewMatrix,
  type Matrix,
  type RecordingScene
} from '../src/renderer/src/recording/frame'
import { buildCameraPath, cameraAt, cameraTargets } from '../src/renderer/src/recording/camera'
import { tiltAt } from '../src/renderer/src/recording/cursor'
import { DEFAULT_RECORDING, type RecordingDoc } from '../src/renderer/src/recording/settings'
import { takeViewFor, type TakeView } from '../src/renderer/src/recording/take-view'
import { wholeTake } from '../src/renderer/src/recording/timemap'
import type { CursorSample, RecordingTrack } from '../src/renderer/src/recording/track'
import type { ZoomSegment } from '../src/renderer/src/recording/zooms'
import type { Point, Rect } from '../src/renderer/src/render/geometry'
import { fakeContext } from './fake-canvas'

vi.mock('../src/renderer/src/recording/cursor-art', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/renderer/src/recording/cursor-art')>()
  return { ...original, drawCursor: vi.fn(original.drawCursor) }
})
vi.mock('../src/renderer/src/recording/effects', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/renderer/src/recording/effects')>()
  return { ...original, drawClickEffect: vi.fn(original.drawClickEffect) }
})

const output = { width: 1920, height: 1080 }
const layout = { content: { x: 96, y: 54, w: 1728, h: 972 }, scale: 0.675 }

const video = { tag: 'video' } as unknown as CanvasImageSource
const still: CursorSample[] = Array.from({ length: 400 }, (_, i) => ({ t: i * 16, x: 1280, y: 720, shape: 'arrow' }))
const track: RecordingTrack = { kind: 'window', width: 2560, height: 1440, fps: 60, durationMs: 6400, scale: 1, cursor: still, clicks: [] }
const settings: RecordingDoc = { ...DEFAULT_RECORDING, trim: { start: 0, end: 6400 }, pieces: wholeTake(6400) }
const viewOf = (take: RecordingTrack, crop: Rect | null = null, recording = settings) =>
  takeViewFor({ id: 'frame', name: 'Recording', poster: null, track: take }, recording, crop)
const withZooms = (view: TakeView, zooms: ZoomSegment[]): TakeView =>
  ({ ...view, zooms, camera: buildCameraPath(cameraTargets(zooms, view.frame, settings.zoomSpeed), settings.zoomSpeed, view.frame) })
const zoomIntoTheMiddle: ZoomSegment = { start: 3000, end: 5000, depth: 2, focus: { x: 1280, y: 720 } }

const zoomScene: RecordingScene = {
  video,
  videoSize: { width: 2560, height: 1440 },
  view: withZooms(viewOf(track), [zoomIntoTheMiddle]),
  doc: { ...DEFAULT_DOC, size: output },
  settings,
  style: DEFAULT_HOUSE_STYLE,
  backdrop: null
}
/** At 4000 the camera holds the zoom and the cursor rests in sight. */
const stillScene: RecordingScene = { ...zoomScene, settings: { ...settings, hideWhenStill: false } }

const fullHd = { width: 1920, height: 1080 }
const sweep: CursorSample[] = still.map((sample) => ({ ...sample, x: 300 + 3 * Math.min(Math.max(sample.t - 700, 0), 500), y: 540 }))
/** From 700 to 1200 ms the cursor moves 3 video px per ms. */
const movingCursorScene: RecordingScene = { ...zoomScene, videoSize: fullHd, view: viewOf({ ...track, ...fullHd, cursor: sweep }) }

const videoDraws = (scene: RecordingScene, t: number) => {
  const fake = fakeContext()
  drawRecordingFrame(fake.ctx, scene, t, 'export')
  return fake.calls.filter((c) => c === 'drawImage:video').length
}

const transformed = ([a, b, c, d, e, f]: Matrix, { x, y }: Point): Point => ({ x: a * x + c * y + e, y: b * x + d * y + f })

describe('viewMatrix', () => {
  it('is the identity when wide', () => {
    expect(viewMatrix({ depth: 1, focus: { x: 1280, y: 720 } }, layout, output)).toEqual([1, 0, 0, 1, 0, 0])
  })
  it('centres the focus at full depth when it is far from the edges', () => {
    const [a, , , d, e, f] = viewMatrix({ depth: 2, focus: { x: 1280, y: 720 } }, layout, output)
    const fx = 96 + 1280 * 0.675
    const fy = 54 + 720 * 0.675
    expect(a).toBe(2)
    expect(d).toBe(2)
    expect(fx * a + e).toBeCloseTo(960)
    expect(fy * d + f).toBeCloseTo(540)
  })
  it('never shows outside the composition', () => {
    const [a, , , , e] = viewMatrix({ depth: 2, focus: { x: 0, y: 0 } }, layout, output)
    expect(e).toBeLessThanOrEqual(0)
    expect(1920 * a + e).toBeGreaterThanOrEqual(1920)
  })
})

describe('shutterTimes', () => {
  it('spreads the shutter by blur strength', () => {
    expect(shutterTimes(1000, 60, 0, 8)).toEqual([1000])
    const ts = shutterTimes(1000, 60, 0.5, 3)
    expect(ts[0]).toBeCloseTo(1000 - 4.1667, 3)
    expect(ts[2]).toBeCloseTo(1000 + 4.1667, 3)
  })
})

describe('motion blur samples', () => {
  it('counts samples so neighbours sit at most 2 px apart, up to the cap', () => {
    expect([sampleCount(0.2, 24), sampleCount(1, 24), sampleCount(10, 24), sampleCount(500, 24)]).toEqual([1, 2, 6, 24])
  })

  it('measures how far the picture’s corners travel', () => {
    const identity: Matrix = [1, 0, 0, 1, 0, 0]
    expect(cornerTravelPx(identity, identity, output)).toBe(0)
    expect(cornerTravelPx(identity, [1, 0, 0, 1, 10, 0], output)).toBe(10)
  })

  it('measures a zoom’s travel on screen, where the picture is seen', () => {
    const centredAt = (depth: number): Matrix => [depth, 0, 0, depth, 960 * (1 - depth), 540 * (1 - depth)]
    expect(cornerTravelPx(centredAt(2), centredAt(2.2), output)).toBeCloseTo(Math.hypot(96, 54), 9)
  })

  it('draws one sharp frame when nothing moves', () => {
    expect(framePlan(stillScene, 4000, 'export')).toEqual({ camera: 1, cursor: 1 })
    expect(videoDraws(stillScene, 4000)).toBe(1)
  })

  it('blurs only the cursor while it moves and the camera rests, with copies at most 2 px apart', () => {
    // a 1920 × 1080 take in a 1920 × 1080 output (layout scale 0.822); the cursor moves 3 video px per ms; Cursor blur 50% at 60 fps
    const plan = framePlan(movingCursorScene, 1000, 'export')
    expect(plan.camera).toBe(1)
    expect(plan.cursor).toBeGreaterThanOrEqual(11)
    expect(plan.cursor).toBeLessThanOrEqual(13)
    expect(framePlan(movingCursorScene, 1000, 'preview', 0.5).cursor).toBeLessThan(plan.cursor)
  })

  it('smears a zoom with camera copies at most 2 px apart and draws the picture once', () => {
    const t = 2700 // the camera is moving into a zoom at 3000
    const h = (0.5 * 1000) / 60 / 2
    const travel = cornerTravelPx(cameraMatrixAt(zoomScene, t - h), cameraMatrixAt(zoomScene, t + h), output)
    expect(framePlan(zoomScene, t, 'export').camera).toBe(Math.min(32, Math.ceil(travel / 2) + 1))
    expect(videoDraws(zoomScene, t)).toBe(1)
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

  it('keeps each frame’s shutter on its own side of a cut, where the cursor jumps', () => {
    const jumpsWithTheCut = { ...track, cursor: still.map((sample) => ({ ...sample, x: sample.t < 4000 ? 500 : 1800 })) }
    const cut: RecordingDoc = {
      ...settings,
      hideWhenStill: false,
      pieces: [{ start: 0, end: 3000, rate: 1, cut: false }, { start: 3000, end: 4000, rate: 1, cut: true }, { start: 4000, end: 6400, rate: 1, cut: false }]
    }
    const scene = { ...zoomScene, settings: cut, view: viewOf(jumpsWithTheCut, null, cut) }
    for (const t of [2996, 3000, 3004]) expect(framePlan(scene, t, 'export')).toEqual({ camera: 1, cursor: 1 })
  })
})

describe('drawRecordingFrame', () => {
  it('averages camera samples as a running mean and leaves the context as it found it', () => {
    const fake = fakeContext()
    fake.ctx.globalAlpha = 0.8
    drawRecordingFrame(fake.ctx, zoomScene, 2700, 'export')
    expect(fake.alphaAtCall['drawImage'].slice(0, 3)).toEqual([1, 1 / 2, 1 / 3])
    expect(fake.calls.filter((c) => c === 'save').length).toBe(fake.calls.filter((c) => c === 'restore').length)
    expect(fake.ctx.globalAlpha).toBe(0.8)
  })

  it('re-projects one picture to where the camera has it at each shutter time', () => {
    const t = 2700
    const fake = fakeContext()
    let current: Matrix = [1, 0, 0, 1, 0, 0]
    const copies: { transform: Matrix; at: number[] }[] = []
    const watched = new Proxy(fake.ctx, {
      get(target, name) {
        if (name === 'setTransform') return (...matrix: Matrix) => { current = matrix }
        if (name === 'drawImage') {
          return (image: { tag?: string }, ...at: number[]) => {
            if (image.tag === 'offscreen') copies.push({ transform: current, at })
          }
        }
        return Reflect.get(target, name)
      }
    })

    drawRecordingFrame(watched, zoomScene, t, 'export')

    const { camera } = framePlan(zoomScene, t, 'export')
    const times = shutterTimes(t, settings.fps, settings.cameraBlur, camera)
    expect(camera).toBeGreaterThan(2)
    expect(copies).toHaveLength(camera)
    copies.forEach(({ transform, at }, i) => {
      for (const corner of [{ x: 0, y: 0 }, { x: output.width, y: output.height }]) {
        const shown = transformed(transform, transformed(cameraMatrixAt(zoomScene, t), corner))
        const expected = transformed(cameraMatrixAt(zoomScene, times[i]), corner)
        expect(shown.x).toBeCloseTo(expected.x, 6)
        expect(shown.y).toBeCloseTo(expected.y, 6)
      }
      expect(at[0]).toBe(at[1])
      expect(at[0]).toBeLessThan(0)
    })
  })

  it('stamps cursor copies additively', () => {
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, movingCursorScene, 1000, 'export')
    expect(fake.calls).toContain('globalCompositeOperation=lighter')
  })

  it('stamps one sprite at 1/n per copy, then lays the copies on the picture', () => {
    vi.mocked(cursorArt.drawCursor).mockClear()
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, movingCursorScene, 1000, 'export')
    const { cursor } = framePlan(movingCursorScene, 1000, 'export')
    expect(cursorArt.drawCursor).toHaveBeenCalledTimes(1)
    expect(fake.layers.map((layer) => layer.alphaAtCall['drawImage'])).toContainEqual(Array(cursor).fill(1 / cursor))
    expect(fake.calls.filter((c) => c.startsWith('drawImage:'))).toHaveLength(1 + cursor + 1)
    expect(fake.alphaAtCall['drawImage']).toEqual([1, 1])
  })

  it('lays a smeared cursor on the picture at its opacity', () => {
    const clickedThenStill = {
      ...track,
      cursor: still.map((sample) => ({ ...sample, x: 800, y: 500 })),
      clicks: [{ t: 1000, x: 800, y: 500, button: 'left' as const, up: 1090 }]
    }
    const fading = { ...zoomScene, view: withZooms(viewOf(clickedThenStill), [zoomIntoTheMiddle]) }
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, fading, 2600, 'export')
    expect(framePlan(fading, 2600, 'export').cursor).toBeGreaterThan(1)
    expect(fake.alphaAtCall['drawImage'].at(-1)).toBeCloseTo(0.5)
  })

  it('draws a still frame straight onto the target, with the cursor as one sprite', () => {
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, zoomScene, 1000, 'export')
    expect(fake.layers).toHaveLength(1)
    expect(fake.calls.filter((c) => c.startsWith('drawImage:'))).toEqual(['drawImage:video', 'drawImage:offscreen'])
    expect(fake.alphaAtCall['drawImage']).toEqual([1, 1])
    expect(fake.calls).not.toContain('globalCompositeOperation=lighter')
  })

  it('lays a still cursor on the picture at its opacity', () => {
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, zoomScene, 1600, 'export')
    expect(fake.alphaAtCall['drawImage']).toEqual([1, 0.5])
  })

  it('leans the cursor with its speed while tilt is on, and keeps it upright with tilt off', () => {
    const gliding = { ...track, cursor: still.map((sample, i) => ({ ...sample, x: 400 + i * 4 })) }
    const view = withZooms(viewOf(gliding), [])
    const drawnTilt = (tilt: boolean) => {
      vi.mocked(cursorArt.drawCursor).mockClear()
      drawRecordingFrame(fakeContext().ctx, { ...zoomScene, view, settings: { ...settings, tilt } }, 3000, 'export')
      return vi.mocked(cursorArt.drawCursor).mock.calls[0][5]
    }
    expect(drawnTilt(true)).toBeGreaterThan(0)
    expect(drawnTilt(true)).toBeCloseTo(tiltAt(view.cursor, 3000, track.scale), 9)
    expect(drawnTilt(false)).toBe(0)
  })

  it('zooms the frame shadow with the camera', () => {
    const frameShadowBlur = (t: number) => {
      const fake = fakeContext()
      drawRecordingFrame(fake.ctx, zoomScene, t, 'export')
      return Number(fake.calls.find((c) => c.startsWith('shadowBlur='))!.split('=')[1])
    }
    expect(frameShadowBlur(4000)).toBeCloseTo(cameraAt(zoomScene.view.camera, 4000).depth * frameShadowBlur(1000))
  })

  it('paints the picture over an opaque base, and its camera copies over another', () => {
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, zoomScene, 2700, 'preview')
    const baseFills = fake.calls.flatMap((c, i) => (c === 'fillStyle=#000' ? [i] : []))
    expect(baseFills).toHaveLength(2)
    expect(baseFills.map((i) => fake.calls[i + 1])).toEqual(['fillRect', 'fillRect'])
    expect(baseFills[0]).toBeLessThan(fake.calls.indexOf('createLinearGradient'))
    expect(baseFills[1]).toBeGreaterThan(fake.calls.indexOf('drawImage:video'))
    expect(baseFills[1]).toBeLessThan(fake.calls.indexOf('drawImage:offscreen'))
  })

  it('draws the cropped part of the video into the frame', () => {
    const cropped = { ...zoomScene, view: viewOf(track, { x: 640, y: 360, w: 1280, h: 720 }), settings: { ...settings, cursorBlur: 0, cameraBlur: 0 } }
    const { content } = recordingLayout(cropped.view.frame, output, DEFAULT_HOUSE_STYLE)
    const fake = fakeContext()
    const videoDrawn: unknown[][] = []
    const recordVideoDraws = (...args: unknown[]) => {
      if (args[0] === video) videoDrawn.push(args.slice(1))
    }
    const ctx = new Proxy(fake.ctx, { get: (target, name) => (name === 'drawImage' ? recordVideoDraws : Reflect.get(target, name)) })
    drawRecordingFrame(ctx, cropped, 1000, 'export')
    expect(videoDrawn).toEqual([[640, 360, 1280, 720, content.x, content.y, content.w, content.h]])
  })

  it('draws the ring and the press of a click made just before the video starts', () => {
    const click = { t: 900, x: 640, y: 360, button: 'left' as const, up: 1400 }
    const clickedBefore = { ...track, clicks: [click], cursor: still.map((s) => ({ ...s, x: 640, y: 360 })) }
    const trimmed = { ...settings, trim: { start: 1000, end: 6400 }, cursorBlur: 0, cameraBlur: 0 }
    const view = takeViewFor({ id: 'frame-before-start', name: 'Recording', poster: null, track: clickedBefore }, trimmed, null)
    vi.mocked(effects.drawClickEffect).mockClear()
    vi.mocked(cursorArt.drawCursor).mockClear()

    drawRecordingFrame(fakeContext().ctx, { ...zoomScene, view, settings: trimmed }, 0, 'export')

    expect(effects.drawClickEffect).toHaveBeenCalledTimes(1)
    expect(vi.mocked(effects.drawClickEffect).mock.calls[0][1].progress).toBeCloseTo(100 / 450)
    expect(cursorArt.drawCursor).toHaveBeenCalledTimes(1)
    expect(vi.mocked(cursorArt.drawCursor).mock.calls[0][4]).toBeCloseTo(effects.PRESS.scale)
  })

  it('draws the click effect and the cursor where they happened, in composition px', () => {
    const click = { t: 1000, x: 640, y: 360, button: 'left' as const, up: 1090 }
    const resting = { ...track, scale: 1.5, clicks: [click], cursor: still.map((s) => ({ ...s, x: 640, y: 360 })) }
    const clicked = { ...zoomScene, view: withZooms(viewOf(resting), []), settings: { ...settings, cursorBlur: 0, cameraBlur: 0 } }
    const { content, scale } = recordingLayout(clicked.videoSize, output, DEFAULT_HOUSE_STYLE)
    const expected = { x: content.x + 640 * scale, y: content.y + 360 * scale }
    vi.mocked(effects.drawClickEffect).mockClear()
    vi.mocked(cursorArt.drawCursor).mockClear()

    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, clicked, 1100, 'export')

    expect(effects.drawClickEffect).toHaveBeenCalledTimes(1)
    const [, effectClick, , color, radius] = vi.mocked(effects.drawClickEffect).mock.calls[0]
    expect(effectClick.x).toBeCloseTo(expected.x)
    expect(effectClick.y).toBeCloseTo(expected.y)
    expect(color).toBe(DEFAULT_HOUSE_STYLE.accent)
    expect(radius).toBeCloseTo(28 * scale * 1.5)

    expect(cursorArt.drawCursor).toHaveBeenCalledTimes(1)
    const [, cursorFrame, , height] = vi.mocked(cursorArt.drawCursor).mock.calls[0]
    expect(cursorFrame.x).toBeCloseTo(expected.x)
    expect(cursorFrame.y).toBeCloseTo(expected.y)
    expect(height).toBeCloseTo(cursorArt.CURSOR_BASE_PX * DEFAULT_RECORDING.cursorSize * scale * 1.5)

    expect(vi.mocked(effects.drawClickEffect).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(cursorArt.drawCursor).mock.invocationCallOrder[0]
    )
  })
})
