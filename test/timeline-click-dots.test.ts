import { describe, expect, it } from 'vitest'
import type { Piece } from '../src/renderer/src/recording/timemap'
import type { Click } from '../src/renderer/src/recording/track'
import { clickDots } from '../src/renderer/src/timeline/click-dots'

const click = (t: number, x: number, y: number, button: Click['button'] = 'left'): Click => ({ t, x, y, button, up: t + 80 })
const piece = (start: number, end: number, cut = false): Piece => ({ start, end, rate: 1, cut })
const video = { width: 1920, height: 1080 }
const whole = { x: 0, y: 0, w: 1920, h: 1080 }
const pieces = [piece(0, 4000), piece(4000, 5000, true), piece(5000, 10_000)]
const trim = { start: 1000, end: 9000 }

describe('the clicks on the Clip row', () => {
  it('shows each left click in the video, dimming one in a cut or outside the trim', () => {
    const clicks = [click(500, 100, 100), click(2000, 100, 100), click(4500, 100, 100), click(6000, 100, 100, 'right'), click(7000, 2000, 100), click(9500, 100, 100)]
    expect(clickDots({ ...video, clicks }, pieces, trim, whole).map(({ t, dimmed }) => [t, dimmed])).toEqual([
      [500, true],
      [2000, false],
      [4500, true],
      [9500, true]
    ])
  })

  it('dims a click outside the crop, which drives nothing, as one in a cut', () => {
    const crop = { x: 400, y: 200, w: 800, h: 600 }
    const clicks = [click(2000, 399, 500), click(3000, 400, 200), click(6000, 1200, 800), click(7000, 1201, 500), click(8000, 800, 801)]
    expect(clickDots({ ...video, clicks }, pieces, trim, crop).map(({ t, dimmed }) => [t, dimmed])).toEqual([
      [2000, true],
      [3000, false],
      [6000, false],
      [7000, true],
      [8000, true]
    ])
  })

  it('keys clicks that share a time apart', () => {
    const clicks = [click(2000, 100, 100), click(2000, 300, 300), click(2000, 300, 300)]
    const keys = clickDots({ ...video, clicks }, pieces, trim, whole).map(({ key }) => key)
    expect(new Set(keys).size).toBe(3)
  })
})
