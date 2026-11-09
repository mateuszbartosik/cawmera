import { describe, expect, it, vi } from 'vitest'
import * as cursorArt from '../src/renderer/src/recording/cursor-art'
import * as effects from '../src/renderer/src/recording/effects'
import { recordingLayout } from '../src/renderer/src/recording/layout'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { drawRecordingFrame, shutterTimes, viewMatrix, type RecordingScene } from '../src/renderer/src/recording/frame'
import { buildCameraPath, cameraAt, cameraTargets } from '../src/renderer/src/recording/camera'
import { DEFAULT_RECORDING, type RecordingDoc } from '../src/renderer/src/recording/settings'
import { takeViewFor, type TakeView } from '../src/renderer/src/recording/take-view'
import { wholeTake } from '../src/renderer/src/recording/timemap'
import type { RecordingTrack } from '../src/renderer/src/recording/track'
import type { ZoomSegment } from '../src/renderer/src/recording/zooms'
import type { Rect } from '../src/renderer/src/render/geometry'
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

describe('drawRecordingFrame', () => {
  const video = { tag: 'video' } as unknown as CanvasImageSource
  const still = Array.from({ length: 400 }, (_, i) => ({ t: i * 16, x: 1280, y: 720, shape: 'arrow' as const }))
  const track: RecordingTrack = { kind: 'window', width: 2560, height: 1440, fps: 60, durationMs: 6400, scale: 1, cursor: still, clicks: [] }
  const settings: RecordingDoc = { ...DEFAULT_RECORDING, trim: { start: 0, end: 6400 }, pieces: wholeTake(6400) }
  const viewOf = (take: RecordingTrack, crop: Rect | null = null) =>
    takeViewFor({ id: 'frame', name: 'Recording', poster: null, track: take }, settings, crop)
  const withZooms = (view: TakeView, zooms: ZoomSegment[]): TakeView =>
    ({ ...view, zooms, camera: buildCameraPath(cameraTargets(zooms, view.frame, settings.zoomSpeed), settings.zoomSpeed, view.frame) })
  const scene: RecordingScene = {
    video,
    videoSize: { width: 2560, height: 1440 },
    view: withZooms(viewOf(track), [{ start: 3000, end: 5000, depth: 2, focus: { x: 1280, y: 720 } }]),
    doc: { ...DEFAULT_DOC, size: output },
    settings,
    style: DEFAULT_HOUSE_STYLE,
    backdrop: null
  }
  const videoDraws = (t: number, quality: 'preview' | 'export', drawn = scene) => {
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, drawn, t, quality)
    return fake.calls.filter((c) => c === 'drawImage:video').length
  }

  it('draws one sample when nothing moves and eight during an exported zoom-in', () => {
    expect(videoDraws(4000, 'export')).toBe(1)
    expect(videoDraws(2700, 'export')).toBe(8)
    expect(videoDraws(1000, 'preview')).toBe(1)
  })

  it('keeps blurring while the camera settles into a zoom, until it moves by under a hundredth of a pixel', () => {
    const panning = { ...scene, view: withZooms(viewOf(track), [{ start: 3000, end: 5000, depth: 2, focus: { x: 900, y: 500 } }]) }
    expect(videoDraws(3000, 'export', panning)).toBe(8)
    expect(videoDraws(4000, 'export', panning)).toBe(1)
  })

  it('blends full-alpha layers into the target as a running mean and leaves the context as it found it', () => {
    const fake = fakeContext()
    fake.ctx.globalAlpha = 0.8
    drawRecordingFrame(fake.ctx, scene, 2700, 'preview')
    expect(fake.alphaAtCall['drawImage']).toEqual([1, 1 / 2, 1 / 3])
    expect(fake.layers).toHaveLength(1)
    expect(fake.layers[0].alphaAtCall['drawImage']).toEqual([1, 1, 1])
    expect(fake.ctx.globalAlpha).toBe(0.8)
    expect(fake.calls.filter((c) => c === 'save')).toHaveLength(fake.calls.filter((c) => c === 'restore').length)
  })

  it('draws a single sample straight onto the target', () => {
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, scene, 1000, 'export')
    expect(fake.layers).toHaveLength(0)
    expect(fake.alphaAtCall['drawImage']).toEqual([1])
  })

  it('zooms the frame shadow with the camera', () => {
    const frameShadowBlur = (t: number) => {
      const fake = fakeContext()
      drawRecordingFrame(fake.ctx, scene, t, 'export')
      return Number(fake.calls.find((c) => c.startsWith('shadowBlur='))!.split('=')[1])
    }
    expect(frameShadowBlur(4000)).toBeCloseTo(cameraAt(scene.view.camera, 4000).depth * frameShadowBlur(1000))
  })

  it('paints every sample over an opaque base before the background', () => {
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, scene, 2700, 'preview')
    const baseFills = fake.calls.flatMap((c, i) => (c === 'fillStyle=#000' ? [i] : []))
    expect(baseFills).toHaveLength(3)
    expect(fake.calls[baseFills[0] + 1]).toBe('fillRect')
    expect(baseFills[0]).toBeLessThan(fake.calls.indexOf('createLinearGradient'))
  })

  it('draws the cropped part of the video into the frame', () => {
    const cropped = { ...scene, view: viewOf(track, { x: 640, y: 360, w: 1280, h: 720 }), settings: { ...settings, motionBlur: 0 } }
    const { content } = recordingLayout(cropped.view.frame, output, DEFAULT_HOUSE_STYLE)
    const fake = fakeContext()
    const videoDraws: unknown[][] = []
    const recordVideoDraws = (...args: unknown[]) => {
      if (args[0] === video) videoDraws.push(args.slice(1))
    }
    const ctx = new Proxy(fake.ctx, { get: (target, name) => (name === 'drawImage' ? recordVideoDraws : Reflect.get(target, name)) })
    drawRecordingFrame(ctx, cropped, 1000, 'export')
    expect(videoDraws).toEqual([[640, 360, 1280, 720, content.x, content.y, content.w, content.h]])
  })

  it('draws the ring and the press of a click made just before the video starts', () => {
    const click = { t: 900, x: 640, y: 360, button: 'left' as const, up: 1400 }
    const clickedBefore = { ...track, clicks: [click], cursor: still.map((s) => ({ ...s, x: 640, y: 360 })) }
    const trimmed = { ...settings, trim: { start: 1000, end: 6400 }, motionBlur: 0 }
    const view = takeViewFor({ id: 'frame-before-start', name: 'Recording', poster: null, track: clickedBefore }, trimmed, null)
    vi.mocked(effects.drawClickEffect).mockClear()
    vi.mocked(cursorArt.drawCursor).mockClear()

    drawRecordingFrame(fakeContext().ctx, { ...scene, view, settings: trimmed }, 0, 'export')

    expect(effects.drawClickEffect).toHaveBeenCalledTimes(1)
    expect(vi.mocked(effects.drawClickEffect).mock.calls[0][1].progress).toBeCloseTo(100 / 450)
    expect(cursorArt.drawCursor).toHaveBeenCalledTimes(1)
    expect(vi.mocked(cursorArt.drawCursor).mock.calls[0][4]).toBeCloseTo(effects.PRESS.scale)
  })

  it('draws the click effect and the cursor where they happened, in composition px', () => {
    const click = { t: 1000, x: 640, y: 360, button: 'left' as const, up: 1090 }
    const resting = { ...track, scale: 1.5, clicks: [click], cursor: still.map((s) => ({ ...s, x: 640, y: 360 })) }
    const clicked = { ...scene, view: withZooms(viewOf(resting), []), settings: { ...settings, motionBlur: 0 } }
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
