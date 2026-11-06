import { describe, expect, it } from 'vitest'
import { autoTrim, clampTrim } from '../src/renderer/src/recording/trim'
import type { Click, CursorSample, RecordingTrack } from '../src/renderer/src/recording/track'

const still = (from: number, to: number, x = 800): CursorSample[] =>
  Array.from({ length: Math.floor((to - from) / 16) }, (_, i) => ({ t: from + i * 16, x, y: 400, shape: 'arrow' as const }))
const track = (cursor: CursorSample[], durationMs: number, clicks: Click[] = []): RecordingTrack =>
  ({ kind: 'monitor', width: 1920, height: 1080, fps: 60, durationMs, scale: 1, cursor, clicks })

describe('auto trim', () => {
  it('cuts the shortcut press when the cursor rests until the end', () => {
    expect(autoTrim(track(still(0, 5000), 5000))).toEqual({ start: 0, end: 4800 })
  })

  it('cuts the final trip to the taskbar', () => {
    const trip = Array.from({ length: 50 }, (_, i) => ({ t: 4000 + i * 16, x: 800 + i * 20, y: 400 + i * 12, shape: 'arrow' as const }))
    expect(autoTrim(track([...still(2000, 4000), ...trip], 4800)).end).toBe(4000)
  })

  it('keeps the end when a click follows the last rest', () => {
    const moves = Array.from({ length: 50 }, (_, i) => ({ t: 4000 + i * 16, x: 800 + i * 20, y: 400, shape: 'arrow' as const }))
    const clicks: Click[] = [{ t: 4700, x: 1700, y: 400, button: 'left', up: 4750 }]
    expect(autoTrim(track([...still(2000, 4000), ...moves], 4800, clicks)).end).toBe(4800)
  })

  it('ignores clicks outside the frame after the last rest', () => {
    const trip = Array.from({ length: 50 }, (_, i) => ({ t: 4000 + i * 16, x: 800 + i * 30, y: 400, shape: 'arrow' as const }))
    const outside: Click[] = [{ t: 4700, x: 2200, y: 400, button: 'left', up: 4750 }]
    expect(autoTrim(track([...still(2000, 4000), ...trip], 4800, outside)).end).toBe(4000)
  })

  it('keeps everything when the cursor never rests', () => {
    const moves = Array.from({ length: 100 }, (_, i) => ({ t: i * 16, x: 100 + i * 10, y: 400, shape: 'arrow' as const }))
    expect(autoTrim(track(moves, 1600))).toEqual({ start: 0, end: 1600 })
  })

  it('never returns an empty or inverted range for very short recordings', () => {
    expect(autoTrim(track(still(0, 300), 300))).toEqual({ start: 0, end: 300 })
    expect(clampTrim({ start: 900, end: 100 }, 1000)).toEqual({ start: 0, end: 1000 })
    expect(clampTrim({ start: 200, end: 400 }, 5000)).toEqual({ start: 200, end: 700 })
  })
})

describe('auto trim of a take stopped from the taskbar', () => {
  interface Spot { x: number; y: number }
  const content: Spot = { x: 800, y: 400 }
  const button: Spot = { x: 900, y: 1060 }
  const thumbnail: Spot = { x: 900, y: 910 }
  const stay = (at: Spot, from: number, to: number) => still(from, to).map((sample) => ({ ...sample, ...at }))
  const glide = (from: Spot, to: Spot, startMs: number, count = 30): CursorSample[] =>
    Array.from({ length: count }, (_, i) => ({
      t: startMs + i * 16,
      x: from.x + ((to.x - from.x) * i) / count,
      y: from.y + ((to.y - from.y) * i) / count,
      shape: 'arrow' as const
    }))
  const stopClickOn = (at: Spot): Click => ({ t: 4900, ...at, button: 'left', up: null })

  it('cuts the wait on Cawmera’s taskbar button along with the trip there', () => {
    const cursor = [...stay(content, 2000, 4000), ...glide(content, button, 4000), ...stay(button, 4480, 5000)]
    expect(autoTrim(track(cursor, 5000), stopClickOn(button)).end).toBe(4000)
  })

  it('cuts a wait outside the frame the same way', () => {
    const belowFrame: Spot = { x: 900, y: 1150 }
    const cursor = [...stay(content, 2000, 4000), ...glide(content, belowFrame, 4000), ...stay(belowFrame, 4480, 5000)]
    expect(autoTrim(track(cursor, 5000), stopClickOn(belowFrame)).end).toBe(4000)
  })

  it('cuts a wait on the button that ends with a click on its thumbnail', () => {
    const cursor = [
      ...stay(content, 2000, 4000),
      ...glide(content, button, 4000),
      ...stay(button, 4480, 4800),
      ...glide(button, thumbnail, 4800, 5),
      ...stay(thumbnail, 4880, 5000)
    ]
    expect(autoTrim(track(cursor, 5000), stopClickOn(thumbnail)).end).toBe(4000)
  })

  it('ends where the cursor left its last rest, even when that rest was just outside the wait', () => {
    const outsideWait: Spot = { x: 900, y: 840 }
    const cursor = [...stay(outsideWait, 2000, 4000), ...stay(button, 4000, 5000)]
    expect(autoTrim(track(cursor, 5000), stopClickOn(button)).end).toBe(3984)
  })

  describe('when the trip starts right after a content click', () => {
    const clicked: Spot = { x: 900, y: 300 }
    const outsideWait: Spot = { x: 900, y: 840 }
    const click: Click = { t: 2480, ...clicked, button: 'left', up: 2560 }

    it('lets the click land, ending 650 ms after it', () => {
      const cursor = [...glide({ x: 700, y: 300 }, clicked, 2000), ...glide(clicked, outsideWait, 2480, 60), ...stay(button, 3440, 5000)]
      expect(autoTrim(track(cursor, 5000, [click]), stopClickOn(button)).end).toBe(2480 + 650)
    })

    it('ends where the wait starts if that comes sooner', () => {
      const cursor = [...glide({ x: 700, y: 300 }, clicked, 2000), ...glide(clicked, outsideWait, 2480, 20), ...stay(button, 2800, 5000)]
      expect(autoTrim(track(cursor, 5000, [click]), stopClickOn(button)).end).toBe(2800)
    })

    it('lets the click land even when a short rest ended just after it', () => {
      const restingClick: Click = { ...click, t: 2500 }
      const cursor = [...stay(clicked, 2000, 2600), ...glide(clicked, outsideWait, 2600, 60), ...stay(button, 3560, 5000)]
      expect(autoTrim(track(cursor, 5000, [restingClick]), stopClickOn(button)).end).toBe(2500 + 650)
    })
  })
})
