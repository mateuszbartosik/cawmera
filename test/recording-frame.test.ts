import { describe, expect, it, vi } from 'vitest'
import * as cursorArt from '../src/renderer/src/recording/cursor-art'
import * as effects from '../src/renderer/src/recording/effects'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { cameraAt } from '../src/renderer/src/recording/camera'
import { cursorPositionAt, tiltAt } from '../src/renderer/src/recording/cursor'
import { drawRecordingFrame, stampWeights, type RecordingScene } from '../src/renderer/src/recording/frame'
import { recordingLayout } from '../src/renderer/src/recording/layout'
import { DEFAULT_RECORDING, type RecordingDoc } from '../src/renderer/src/recording/settings'
import { cameraMatrixAt, cornerTravelPx, framePlan, shutterTimes } from '../src/renderer/src/recording/shutter'
import { takeViewFor } from '../src/renderer/src/recording/take-view'
import type { Matrix, Point } from '../src/renderer/src/render/geometry'
import { fakeContext, type FakeLayer } from './fake-canvas'
import {
  movingCursorScene,
  output,
  settings,
  still,
  stillScene,
  track,
  video,
  viewOf,
  withZooms,
  zoomIntoTheMiddle,
  zoomScene
} from './recording-scenes'

vi.mock('../src/renderer/src/recording/cursor-art', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/renderer/src/recording/cursor-art')>()
  return { ...original, drawCursor: vi.fn(original.drawCursor) }
})
vi.mock('../src/renderer/src/recording/effects', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/renderer/src/recording/effects')>()
  return { ...original, drawClickEffect: vi.fn(original.drawClickEffect) }
})

type Fake = ReturnType<typeof fakeContext>

const identity: Matrix = [1, 0, 0, 1, 0, 0]
const halfShutter = (0.5 * 1000) / 60 / 2

const transformed = ([a, b, c, d, e, f]: Matrix, { x, y }: Point): Point => ({ x: a * x + c * y + e, y: b * x + d * y + f })
const scaled = (matrix: Matrix, k: number) => matrix.map((value) => value * k) as Matrix

const videoDraws = (scene: RecordingScene, t: number) => {
  const fake = fakeContext()
  drawRecordingFrame(fake.ctx, scene, t, 'export')
  return fake.calls.filter((c) => c === 'drawImage:video').length
}

/** Where the cursor’s hotspot belongs on a canvas `k` px per output px: the camera’s view of the path at that time. */
function hotspotOnCanvas(scene: RecordingScene, t: number, k: number): Point {
  const { content, scale } = recordingLayout(scene.view.frame, scene.doc.size, scene.style)
  const onPath = cursorPositionAt(scene.view.cursor, t)
  return transformed(scaled(cameraMatrixAt(scene, t), k), { x: content.x + onPath.x * scale, y: content.y + onPath.y * scale })
}

/** The sprite layer, the transform the cursor was drawn under in it, and where that put the hotspot. */
function spriteOf(fake: Fake) {
  const [spriteContext, frame] = vi.mocked(cursorArt.drawCursor).mock.lastCall!
  const layer = fake.layers.find((candidate) => candidate.ctx === spriteContext)!
  const transform = layer.argsAtCall['setTransform'].at(-1) as Matrix
  return { layer, transform, hotspot: transformed(transform, frame) }
}

/** Where a layer drawn with `drawImage` puts its own (0, 0), checking it is copied without scaling. */
function placement(args: unknown[]): Point {
  const [, sx, sy, sw, sh, dx, dy, dw, dh] = args as number[]
  expect([dw, dh]).toEqual([sw, sh])
  return { x: dx - sx, y: dy - sy }
}

const drawsOf = (layer: Pick<FakeLayer, 'argsAtCall'>, image: unknown) => (layer.argsAtCall['drawImage'] ?? []).filter((args) => args[0] === image)

function expectCloseTo(actual: Point, expected: Point) {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
}

describe('stampWeights', () => {
  it('weighs n cursor copies in whole 255ths, spread evenly, adding up to exactly one', () => {
    expect(stampWeights(1)).toEqual([255])
    for (const n of [2, 12, 19, 46, 47, 48]) {
      const weights = stampWeights(n)
      const light = Math.floor(255 / n)
      expect(weights).toHaveLength(n)
      expect(weights.every((weight) => weight === light || weight === light + 1)).toBe(true)
      weights.reduce((sum, weight, i) => {
        expect(Math.abs(sum + weight - (255 * (i + 1)) / n)).toBeLessThan(1)
        return sum + weight
      }, 0)
      expect(weights.reduce((sum, weight) => sum + weight, 0)).toBe(255)
    }
  })
})

describe('drawRecordingFrame', () => {
  it('draws one sharp frame when nothing moves', () => {
    expect(framePlan(stillScene, 4000, 'export')).toEqual({ camera: 1, cursor: 1 })
    expect(videoDraws(stillScene, 4000)).toBe(1)
  })

  it('smears a zoom with camera copies at most 2 px apart and draws the picture once', () => {
    const t = 2700 // the camera is moving into a zoom at 3000
    const h = (0.5 * 1000) / 60 / 2
    const travel = cornerTravelPx(cameraMatrixAt(zoomScene, t - h), cameraMatrixAt(zoomScene, t + h), output)
    expect(framePlan(zoomScene, t, 'export').camera).toBe(Math.min(32, Math.ceil(travel / 2) + 1))
    expect(videoDraws(zoomScene, t)).toBe(1)
  })

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
    let current: Matrix = identity
    const copies: { transform: Matrix; args: unknown[] }[] = []
    const watched = new Proxy(fake.ctx, {
      get(target, name) {
        if (name === 'setTransform') return (...matrix: Matrix) => { current = matrix }
        if (name === 'drawImage') {
          return (...args: unknown[]) => {
            if ((args[0] as { tag?: string }).tag === 'offscreen') copies.push({ transform: current, args })
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
    copies.forEach(({ transform, args }, i) => {
      for (const corner of [{ x: 0, y: 0 }, { x: output.width, y: output.height }]) {
        expectCloseTo(transformed(transform, transformed(cameraMatrixAt(zoomScene, t), corner)), transformed(cameraMatrixAt(zoomScene, times[i]), corner))
      }
      const margin = -placement(args).x
      expect(placement(args)).toEqual({ x: -margin, y: -margin })
      expect(margin).toBeGreaterThan(0)
    })
  })

  it('reuses one picture layer as the camera speeds up and slows down, with a margin of the travel plus 2 px', () => {
    const fake = fakeContext()
    const frames = [2200, 2300, 2500, 2700, 2900].map((t) => {
      const before = fake.argsAtCall['drawImage']?.length ?? 0
      drawRecordingFrame(fake.ctx, zoomScene, t, 'export')
      return { t, copies: fake.argsAtCall['drawImage'].slice(before) }
    })

    const pictures = fake.layers.filter((layer) => drawsOf(layer, video).length > 0)
    expect(pictures).toHaveLength(1)
    const [picture] = pictures
    for (const { t, copies } of frames) {
      const travel = cornerTravelPx(cameraMatrixAt(zoomScene, t - halfShutter), cameraMatrixAt(zoomScene, t + halfShutter), output)
      const margin = Math.ceil(travel) + 2
      expect(copies.length).toBeGreaterThan(1)
      for (const args of copies) {
        expect(args[0]).toBe(picture.canvas)
        expect(args.slice(1, 5)).toEqual([0, 0, output.width + 2 * margin, output.height + 2 * margin])
        expect(placement(args)).toEqual({ x: -margin, y: -margin })
        expect(picture.canvas.width).toBeGreaterThanOrEqual(output.width + 2 * margin)
      }
    }
  })

  it('stamps cursor copies additively', () => {
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, movingCursorScene, 1000, 'export')
    expect(fake.calls).toContain('globalCompositeOperation=lighter')
  })

  it('stamps one sprite in a float16 layer, weighed in whole 255ths that add up to one, then lays the copies on the picture', () => {
    vi.mocked(cursorArt.drawCursor).mockClear()
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, movingCursorScene, 1000, 'export')
    const { cursor } = framePlan(movingCursorScene, 1000, 'export')
    const sprite = spriteOf(fake)
    const stamps = fake.layers.find((layer) => drawsOf(layer, sprite.layer.canvas).length > 0)!
    expect(cursorArt.drawCursor).toHaveBeenCalledTimes(1)
    expect(stamps.settings).toEqual({ colorType: 'float16' })
    expect(stamps.alphaAtCall['drawImage']).toEqual(stampWeights(cursor).map((weight) => weight / 255))
    expect(fake.calls.filter((c) => c.startsWith('drawImage:'))).toHaveLength(1 + cursor + 1)
    expect(fake.alphaAtCall['drawImage']).toEqual([1, 1])
  })

  it('keeps an 8-bit stamps layer, weighed the same, where the browser refuses float16', () => {
    const fake = fakeContext()
    const WithFloat16 = globalThis.OffscreenCanvas as unknown as new (width: number, height: number) => {
      getContext(type: string, settings?: { colorType?: string }): unknown
    }
    globalThis.OffscreenCanvas = class extends WithFloat16 {
      getContext(type: string, settings?: { colorType?: string }) {
        return settings?.colorType === 'float16' ? null : super.getContext(type, settings)
      }
    } as unknown as typeof OffscreenCanvas
    drawRecordingFrame(fake.ctx, movingCursorScene, 1000, 'export')
    const { cursor } = framePlan(movingCursorScene, 1000, 'export')
    const stamps = fake.layers.find((layer) => layer.alphaAtCall['drawImage']?.length === cursor)!
    expect(stamps.settings).toBeUndefined()
    expect(stamps.alphaAtCall['drawImage']).toEqual(stampWeights(cursor).map((weight) => weight / 255))
  })

  it('puts a still cursor’s hotspot where the camera shows it, scaled by the zoom and the canvas', () => {
    const t = 4000
    const k = 0.75
    vi.mocked(cursorArt.drawCursor).mockClear()
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, stillScene, t, 'preview', k)

    expect(framePlan(stillScene, t, 'preview', k).cursor).toBe(1)
    const sprite = spriteOf(fake)
    const depth = cameraAt(stillScene.view.camera, t).depth
    expect(depth).toBeGreaterThan(1.9)
    expect(sprite.transform.slice(0, 4).map((value) => value / (depth * k))).toEqual([1, 0, 0, 1])
    const shown = drawsOf(fake, sprite.layer.canvas)
    expect(shown).toHaveLength(1)
    expect(fake.argsAtCall['setTransform'].at(-1)).toEqual(identity)
    const origin = placement(shown[0])
    expect(Number.isInteger(origin.x) && Number.isInteger(origin.y)).toBe(true)
    expectCloseTo({ x: origin.x + sprite.hotspot.x, y: origin.y + sprite.hotspot.y }, hotspotOnCanvas(stillScene, t, k))
  })

  it('stamps the cursor’s hotspot where the camera shows it at every shutter time', () => {
    const t = 2700
    const k = 0.75
    const sweeping = { ...track, cursor: still.map((sample) => ({ ...sample, x: 500 + sample.t / 2 })) }
    const scene = { ...zoomScene, view: withZooms(viewOf(sweeping), [zoomIntoTheMiddle]) }
    vi.mocked(cursorArt.drawCursor).mockClear()
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, scene, t, 'preview', k)

    const { camera, cursor } = framePlan(scene, t, 'preview', k)
    expect(camera).toBeGreaterThan(1)
    expect(cursor).toBeGreaterThan(2)
    const sprite = spriteOf(fake)
    const depth = cameraAt(scene.view.camera, t).depth
    expect(sprite.transform.slice(0, 4).map((value) => value / (depth * k))).toEqual([1, 0, 0, 1])
    const stamps = fake.layers.find((layer) => drawsOf(layer, sprite.layer.canvas).length > 0)!
    expect(stamps.argsAtCall['setTransform'].every((matrix) => matrix.every((value, i) => value === identity[i]))).toBe(true)
    const layerOrigin = placement(drawsOf(fake, stamps.canvas)[0])
    expect(fake.argsAtCall['setTransform'].at(-1)).toEqual(identity)

    const times = shutterTimes(t, settings.fps, settings.cursorBlur, cursor)
    const copies = drawsOf(stamps, sprite.layer.canvas)
    expect(copies).toHaveLength(cursor)
    copies.forEach((args, i) => {
      const stampOrigin = placement(args)
      const landed = { x: layerOrigin.x + stampOrigin.x + sprite.hotspot.x, y: layerOrigin.y + stampOrigin.y + sprite.hotspot.y }
      expectCloseTo(landed, hotspotOnCanvas(scene, times[i], k))
    })
  })

  it('keeps the cursor’s layer within the canvas however far the cursor flies in one frame', () => {
    const raw: RecordingDoc = { ...settings, smoothing: 0, hideWhenStill: false, cursorBlur: 1 }
    const flick = { ...track, cursor: still.map((sample) => ({ ...sample, x: sample.t < 4000 ? 100 : 2400 })) }
    const scene = { ...zoomScene, settings: raw, view: withZooms(viewOf(flick, null, raw), [zoomIntoTheMiddle]) }
    const t = 3992
    const reach = [hotspotOnCanvas(scene, 3984, 1).x, hotspotOnCanvas(scene, 4000, 1).x]
    expect(reach[0]).toBeLessThan(0)
    expect(reach[1]).toBeGreaterThan(output.width)

    vi.mocked(cursorArt.drawCursor).mockClear()
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, scene, t, 'export')

    const sprite = spriteOf(fake)
    const stamps = fake.layers.find((layer) => drawsOf(layer, sprite.layer.canvas).length > 0)!
    expect(stamps.canvas.width).toBeLessThanOrEqual(output.width)
    expect(stamps.canvas.height).toBeLessThanOrEqual(output.height)
    const [, sx, sy, sw, sh, dx, dy] = drawsOf(fake, stamps.canvas)[0] as number[]
    expect([sx, sy]).toEqual([0, 0])
    expect(dx).toBeGreaterThanOrEqual(0)
    expect(dy).toBeGreaterThanOrEqual(0)
    expect(dx + sw).toBeLessThanOrEqual(output.width)
    expect(dy + sh).toBeLessThanOrEqual(output.height)
    expect(stamps.argsAtCall['clearRect'][0]).toEqual([0, 0, sw, sh])
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

  it('holds the cursor on a click at the video’s end as one sharp copy, though the take moved it on', () => {
    const click = { t: 6000, x: 1000, y: 600, button: 'left' as const, up: 6090 }
    const movesOn = { ...track, clicks: [click], cursor: still.map((sample) => ({ ...sample, x: 1000 + 2 * (sample.t - 6000), y: 600 })) }
    const scene = { ...stillScene, view: withZooms(viewOf(movesOn), []) }
    const t = 6200
    vi.mocked(cursorArt.drawCursor).mockClear()
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, scene, t, 'export')

    expect(framePlan(scene, t, 'export')).toEqual({ camera: 1, cursor: 1 })
    expect(fake.calls).not.toContain('globalCompositeOperation=lighter')
    expect(cursorArt.drawCursor).toHaveBeenCalledTimes(1)
    const sprite = spriteOf(fake)
    const origin = placement(drawsOf(fake, sprite.layer.canvas)[0])
    const { content, scale } = recordingLayout(scene.view.frame, output, DEFAULT_HOUSE_STYLE)
    expectCloseTo({ x: origin.x + sprite.hotspot.x, y: origin.y + sprite.hotspot.y }, { x: content.x + click.x * scale, y: content.y + click.y * scale })
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
    drawRecordingFrame(fake.ctx, cropped, 1000, 'export')
    expect(drawsOf(fake, video).map((args) => args.slice(1))).toEqual([[640, 360, 1280, 720, content.x, content.y, content.w, content.h]])
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
