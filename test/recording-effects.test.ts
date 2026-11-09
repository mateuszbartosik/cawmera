import { describe, expect, it } from 'vitest'
import { CURSOR_ART, cursorMatrix, drawCursor, leansWhileMoving } from '../src/renderer/src/recording/cursor-art'
import { activeClicks, drawClickEffect, pressScale } from '../src/renderer/src/recording/effects'
import { CURSOR_SHAPES } from '../src/renderer/src/recording/track'
import { fakeContext } from './fake-canvas'

const click = { t: 1000, x: 50, y: 60, button: 'left' as const, up: 1090 }
const frame = { width: 100, height: 100 }

describe('cursor art', () => {
  it('has art with a hotspot inside the 32 box for every shape', () => {
    for (const shape of CURSOR_SHAPES) {
      const { d, hotspot } = CURSOR_ART[shape]
      expect(d.length).toBeGreaterThan(0)
      expect(hotspot.x).toBeGreaterThanOrEqual(0)
      expect(hotspot.x).toBeLessThanOrEqual(32)
      expect(hotspot.y).toBeGreaterThanOrEqual(0)
      expect(hotspot.y).toBeLessThanOrEqual(32)
    }
  })

  it('puts the hotspot exactly at the cursor position', () => {
    const [a, , , d, e, f] = cursorMatrix('arrow', { x: 300, y: 200 }, 32)
    const hs = CURSOR_ART.arrow.hotspot
    expect(a).toBe(1)
    expect(d).toBe(1)
    expect(e + hs.x * a).toBeCloseTo(300)
    expect(f + hs.y * d).toBeCloseTo(200)
  })

  it('scales by height over 32', () => {
    expect(cursorMatrix('hand', { x: 0, y: 0 }, 64).slice(0, 4)).toEqual([2, 0, 0, 2])
  })

  it('keeps the hotspot on the cursor position when tilted', () => {
    const [a, b, c, d, e, f] = cursorMatrix('arrow', { x: 300, y: 200 }, 32, 0.2)
    const { x, y } = CURSOR_ART.arrow.hotspot
    expect(a * x + c * y + e).toBeCloseTo(300)
    expect(b * x + d * y + f).toBeCloseTo(200)
  })

  it('turns the art clockwise by the tilt, so the arrow’s tail trails left', () => {
    const turned = cursorMatrix('arrow', { x: 300, y: 200 }, 64, 0.2).slice(0, 4)
    const expected = [Math.cos(0.2), Math.sin(0.2), -Math.sin(0.2), Math.cos(0.2)].map((value) => 2 * value)
    turned.forEach((value, i) => expect(value).toBeCloseTo(expected[i]))
  })

  it('leans only the shapes held by their tip', () => {
    expect(CURSOR_SHAPES.filter(leansWhileMoving)).toEqual(['arrow', 'hand', 'progress', 'help', 'other'])
  })

  it('keeps shapes held by their centre upright, whatever the tilt', () => {
    const upright = CURSOR_SHAPES.filter((shape) => !leansWhileMoving(shape))
    expect(upright).toEqual(['ibeam', 'wait', 'crosshair', 'not-allowed', 'move', 'resize-ew', 'resize-ns', 'resize-nwse', 'resize-nesw'])
    for (const shape of upright) expect(cursorMatrix(shape, { x: 300, y: 200 }, 32, 0.2)).toEqual(cursorMatrix(shape, { x: 300, y: 200 }, 32))
  })

  it('draws the cursor turned by the tilt', () => {
    const { ctx } = fakeContext()
    const transforms: unknown[][] = []
    const recordTransforms = (...matrix: unknown[]) => transforms.push(matrix)
    const watched = new Proxy(ctx, { get: (target, name) => (name === 'transform' ? recordTransforms : Reflect.get(target, name)) })
    drawCursor(watched, { x: 300, y: 200, shape: 'arrow', opacity: 1 }, 'light', 32, 0.85, 0.2)
    expect(transforms).toEqual([cursorMatrix('arrow', { x: 300, y: 200 }, 32 * 0.85, 0.2)])
    expect(transforms).not.toEqual([cursorMatrix('arrow', { x: 300, y: 200 }, 32 * 0.85)])
  })

  it('draws every shape in both looks', () => {
    for (const shape of CURSOR_SHAPES) {
      for (const look of ['light', 'dark'] as const) {
        const { ctx, calls } = fakeContext()
        drawCursor(ctx, { x: 10, y: 10, shape, opacity: 1 }, look, 22, 1)
        expect(calls).toContain('fill')
        expect(calls).toContain('stroke')
      }
    }
  })
})

describe('click effects', () => {
  it('runs a ring for 450 ms and a ripple for 650 ms', () => {
    expect(activeClicks([click], 1225, 'ring', frame)[0].progress).toBeCloseTo(0.5)
    expect(activeClicks([click], 1460, 'ring', frame)).toEqual([])
    expect(activeClicks([click], 1600, 'ripple', frame)).toHaveLength(1)
    expect(activeClicks([click], 1225, 'off', frame)).toEqual([])
  })

  it('shows no effect for right clicks or clicks outside the frame', () => {
    expect(activeClicks([{ ...click, button: 'right' }], 1100, 'ring', frame)).toEqual([])
    expect(activeClicks([{ ...click, x: 150 }], 1100, 'ring', frame)).toEqual([])
  })

  it('presses the cursor while the button is down', () => {
    expect(pressScale([click], 1050)).toBeCloseTo(0.85)
    expect(pressScale([click], 1090 + 120)).toBe(1)
    expect(pressScale([click], 900)).toBe(1)
  })

  it('keeps pressing while the button is still held', () => {
    expect(pressScale([{ ...click, up: null }], 5000)).toBeCloseTo(0.85)
  })

  it('eases back between release and full recovery', () => {
    const halfway = pressScale([click], 1090 + 60)
    expect(halfway).toBeGreaterThan(0.85)
    expect(halfway).toBeLessThan(1)
  })

  it('draws a ring as a stroke and a ripple as a fill plus a stroke', () => {
    const ring = fakeContext()
    drawClickEffect(ring.ctx, { x: 5, y: 5, progress: 0.5 }, 'ring', '#ff0000', 20)
    expect(ring.calls).toContain('stroke')
    expect(ring.calls).not.toContain('fill')

    const ripple = fakeContext()
    drawClickEffect(ripple.ctx, { x: 5, y: 5, progress: 0.9 }, 'ripple', '#ff0000', 20)
    expect(ripple.calls).toContain('fill')
    expect(ripple.calls).toContain('stroke')
  })
})

describe('alpha composition', () => {
  it('multiplies the cursor opacity into the caller alpha and restores it', () => {
    const { ctx, alphaAtCall } = fakeContext()
    ctx.globalAlpha = 0.5
    drawCursor(ctx, { x: 0, y: 0, shape: 'arrow', opacity: 0.5 }, 'light', 22, 1)
    expect(alphaAtCall.stroke).toEqual([0.25])
    expect(alphaAtCall.fill).toEqual([0.25])
    expect(ctx.globalAlpha).toBe(0.5)
  })

  it('multiplies the ring alpha into the caller alpha and restores it', () => {
    const { ctx, alphaAtCall } = fakeContext()
    ctx.globalAlpha = 0.5
    drawClickEffect(ctx, { x: 5, y: 5, progress: 0.5 }, 'ring', '#ff0000', 20)
    expect(alphaAtCall.stroke[0]).toBeCloseTo(0.5 * 0.9 * 0.5)
    expect(ctx.globalAlpha).toBe(0.5)
  })

  it('weights the ripple disc and its ring against the caller alpha, not each other', () => {
    const { ctx, alphaAtCall } = fakeContext()
    ctx.globalAlpha = 0.5
    drawClickEffect(ctx, { x: 5, y: 5, progress: 0.9 }, 'ripple', '#ff0000', 20)
    expect(alphaAtCall.fill[0]).toBeCloseTo(0.5 * 0.35 * 0.1)
    const ringProgress = (0.9 * 650 - 120) / 530
    expect(alphaAtCall.stroke[0]).toBeCloseTo(0.5 * 0.9 * (1 - ringProgress))
    expect(ctx.globalAlpha).toBe(0.5)
  })
})
