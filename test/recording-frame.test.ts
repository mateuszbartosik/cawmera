import { describe, expect, it } from 'vitest'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { buildCursorPath } from '../src/renderer/src/recording/cursor'
import { drawRecordingFrame, shutterTimes, viewMatrix } from '../src/renderer/src/recording/frame'
import { DEFAULT_RECORDING } from '../src/renderer/src/recording/settings'
import { fakeContext } from './fake-canvas'

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
  const track = { kind: 'window' as const, width: 2560, height: 1440, fps: 60, durationMs: 6400, scale: 1, cursor: still, clicks: [] }
  const scene = {
    video,
    videoSize: { width: 2560, height: 1440 },
    track,
    zooms: [{ start: 3000, end: 5000, depth: 2, focus: { x: 1280, y: 720 } }],
    path: buildCursorPath(track, 0),
    doc: { ...DEFAULT_DOC, size: output },
    settings: { ...DEFAULT_RECORDING, trim: { start: 0, end: 6400 } },
    style: DEFAULT_HOUSE_STYLE,
    backdrop: null
  }
  const videoDraws = (t: number, quality: 'preview' | 'export') => {
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, scene, t, quality)
    return fake.calls.filter((c) => c === 'drawImage:video').length
  }

  it('draws one sample when nothing moves and eight during an exported zoom-in', () => {
    expect(videoDraws(4000, 'export')).toBe(1)
    expect(videoDraws(2700, 'export')).toBe(8)
    expect(videoDraws(1000, 'preview')).toBe(1)
  })

  it('draws the samples as a running mean and leaves the context as it found it', () => {
    const fake = fakeContext()
    fake.ctx.globalAlpha = 0.8
    drawRecordingFrame(fake.ctx, scene, 2700, 'preview')
    expect(fake.alphaAtCall['drawImage']).toHaveLength(3)
    expect(fake.alphaAtCall['drawImage']).toEqual([1, 1 / 2, 1 / 3])
    expect(fake.ctx.globalAlpha).toBe(0.8)
    expect(fake.calls.filter((c) => c === 'save')).toHaveLength(fake.calls.filter((c) => c === 'restore').length)
  })
})
