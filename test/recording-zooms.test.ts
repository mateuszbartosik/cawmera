import { describe, expect, it } from 'vitest'
import { autoZooms, ZOOM_RULES } from '../src/renderer/src/recording/zooms'

const frame = { width: 1920, height: 1080 }
const click = (t: number, x: number, y: number, button: 'left' | 'right' = 'left') => ({ t, x, y, button, up: t + 80 })

describe('autoZooms', () => {
  it('makes no zooms without clicks', () => expect(autoZooms([], frame, 10_000)).toEqual([]))

  it('ignores right clicks and clicks outside the frame', () => {
    expect(autoZooms([click(3000, 100, 100, 'right'), click(4000, -5, 100), click(5000, 100, 2000)], frame, 10_000)).toEqual([])
  })

  it('groups clicks within 3 s and holds 1.5 s after the last', () => {
    const zooms = autoZooms([click(3000, 900, 500), click(5000, 1000, 560)], frame, 20_000)
    expect(zooms).toHaveLength(1)
    expect(zooms[0].start).toBe(2900)
    expect(zooms[0].end).toBe(6500)
  })

  it('starts a new zoom after a gap over 3 s', () => {
    expect(autoZooms([click(3000, 900, 500), click(6100, 900, 500)], frame, 20_000)).toHaveLength(2)
  })

  it('picks the deepest depth up to 2.5× that keeps the clicks in view', () => {
    expect(autoZooms([click(3000, 960, 540)], frame, 20_000)[0].depth).toBe(2.5)
    const wide = autoZooms([click(3000, 300, 540), click(3500, 1300, 540)], frame, 20_000)[0]
    expect(wide.depth).toBeGreaterThanOrEqual(1.25)
    expect(wide.depth).toBeLessThan(2.5)
  })

  it('keeps the zoomed view inside the frame', () => {
    const z = autoZooms([click(3000, 5, 5)], frame, 20_000)[0]
    expect(z.focus.x).toBeCloseTo(1920 / (2 * z.depth))
    expect(z.focus.y).toBeCloseTo(1080 / (2 * z.depth))
  })

  it('keeps the first and last second wide', () => {
    const [z] = autoZooms([click(400, 900, 500), click(1200, 900, 500)], frame, 3000)
    expect(z.start).toBe(1000)
    expect(z.end).toBe(2000)
  })

  it('drops a zoom squeezed under 600 ms by the wide edges', () => {
    expect(autoZooms([click(9400, 900, 500)], frame, 10_000)).toEqual([])
  })

  it('meets overlapping zooms that cannot merge at the midpoint between their clicks', () => {
    const zooms = autoZooms([click(3000, 100, 100), click(4000, 1800, 1000)], frame, 20_000)
    expect(zooms).toHaveLength(2)
    expect(zooms[0].end).toBe(3500)
    expect(zooms[1].start).toBe(3500)
  })

  it('merges overlapping zooms whose clicks all fit at the minimum depth', () => {
    const rules = { ...ZOOM_RULES, groupGapMs: 1000 }
    const zooms = autoZooms([click(3000, 300, 540), click(4200, 1300, 540)], frame, 20_000, rules)
    expect(zooms).toHaveLength(1)
    expect(zooms[0].start).toBe(2900)
    expect(zooms[0].end).toBe(5700)
    expect(zooms[0].depth).toBeCloseTo(1920 / (1000 + 2 * 0.1 * 1920))
    expect(zooms[0].focus.x).toBeCloseTo(800)
    expect(zooms[0].focus.y).toBeCloseTo(540)
  })
})
