import { describe, expect, it } from 'vitest'
import { cutRange } from '../src/renderer/src/recording/pieces'
import { wholeTake } from '../src/renderer/src/recording/timemap'
import {
  dragTrim,
  fitView,
  formatClock,
  formatLength,
  formatRulerLabel,
  playheadDrag,
  scrollView,
  tickStep,
  timeToX,
  wholeView,
  xToTime,
  zoomView
} from '../src/renderer/src/timeline/scale'

describe('timeline scale', () => {
  const whole = wholeView(10_000)
  const view = { start: 10_000, end: 20_000 }

  it('maps time to x and back', () => {
    expect(timeToX(2500, whole, 800)).toBe(200)
    expect(xToTime(200, whole, 800)).toBe(2500)
    expect(xToTime(-5, whole, 800)).toBe(0)
    expect(xToTime(900, whole, 800)).toBe(10_000)
  })

  it('maps time to x within the visible window', () => {
    expect(timeToX(15_000, view, 800)).toBe(400)
    expect(xToTime(400, view, 800)).toBe(15_000)
    expect(xToTime(-10, view, 800)).toBe(10_000)
    expect(xToTime(900, view, 800)).toBe(20_000)
  })

  it('spaces ruler labels at least 64 px apart', () => {
    expect(tickStep({ start: 0, end: 48_600 }, 812)).toBe(5000)
    expect(tickStep(wholeView(10 * 60_000), 812)).toBe(60000)
  })

  it('spaces ruler labels for the visible window', () => {
    expect(tickStep({ start: 30_000, end: 36_000 }, 812)).toBe(1000)
  })

  it('steps the ruler by 2, 5 or 10 minutes over a long take', () => {
    expect(tickStep(wholeView(20 * 60_000), 812)).toBe(120_000)
    expect(tickStep(wholeView(60 * 60_000), 812)).toBe(300_000)
    expect(tickStep(wholeView(2 * 60 * 60_000), 812)).toBe(600_000)
  })

  it('zooms around the pointer, never closer than 2 s or wider than the take', () => {
    const zoomed = zoomView(view, 2, 12_500, 60_000)
    expect(zoomed.end - zoomed.start).toBe(5000)
    expect((12_500 - zoomed.start) / 5000).toBeCloseTo(0.25)
    const close = zoomView({ start: 0, end: 3000 }, 4, 1000, 60_000)
    expect(close.end - close.start).toBeCloseTo(2000)
    expect(zoomView(view, 0.01, 15_000, 60_000)).toEqual({ start: 0, end: 60_000 })
  })

  it('keeps the zoomed window inside the take', () => {
    expect(zoomView({ start: 0, end: 10_000 }, 2, 0, 60_000)).toEqual({ start: 0, end: 5000 })
    expect(zoomView({ start: 50_000, end: 60_000 }, 2, 60_000, 60_000)).toEqual({ start: 55_000, end: 60_000 })
  })

  it('shows a take shorter than 2 s whole', () => {
    expect(zoomView(wholeView(1500), 4, 700, 1500)).toEqual({ start: 0, end: 1500 })
  })

  it('scrolls without leaving the take', () => {
    expect(scrollView(view, 45_000, 60_000)).toEqual({ start: 50_000, end: 60_000 })
    expect(scrollView(view, -20_000, 60_000)).toEqual({ start: 0, end: 10_000 })
    expect(scrollView(view, 1500, 60_000)).toEqual({ start: 11_500, end: 21_500 })
  })

  it('fits a stored window to the take', () => {
    expect(fitView(null, 60_000)).toEqual({ start: 0, end: 60_000 })
    expect(fitView(view, 60_000)).toEqual(view)
    expect(fitView(view, 15_000)).toEqual({ start: 5000, end: 15_000 })
    expect(fitView({ start: 0, end: 30_000 }, 15_000)).toEqual({ start: 0, end: 15_000 })
  })

  it('drags trim handles within limits', () => {
    expect(dragTrim({ start: 0, end: 9000 }, 'start', 8800, 10_000, wholeTake(10_000))).toEqual({ start: 8500, end: 9000 })
    expect(dragTrim({ start: 0, end: 9000 }, 'end', 12_000, 10_000, wholeTake(10_000))).toEqual({ start: 0, end: 10_000 })
  })

  it('keeps the other handle where it is', () => {
    expect(dragTrim({ start: 1000, end: 9000 }, 'start', 3000, 10_000, wholeTake(10_000))).toEqual({ start: 3000, end: 9000 })
    expect(dragTrim({ start: 1000, end: 9000 }, 'end', 1200, 10_000, wholeTake(10_000))).toEqual({ start: 1000, end: 1500 })
    expect(dragTrim({ start: 1000, end: 9000 }, 'start', -400, 10_000, wholeTake(10_000))).toEqual({ start: 0, end: 9000 })
  })

  it('stops a handle where the output would play under half a second, counting cuts', () => {
    const trim = { start: 0, end: 10_000 }
    const tailCut = cutRange(wholeTake(10_000), { start: 9000, end: 9900 }, trim)!
    expect(dragTrim(trim, 'start', 9500, 10_000, tailCut)).toEqual({ start: 8600, end: 10_000 })
    const headCut = cutRange(wholeTake(10_000), { start: 100, end: 1000 }, trim)!
    expect(dragTrim(trim, 'end', 500, 10_000, headCut)).toEqual({ start: 0, end: 1400 })
    expect(dragTrim(trim, 'end', 5000, 10_000, headCut)).toEqual({ start: 0, end: 5000 })
  })

  it('has no width to map into without a duration', () => {
    expect(timeToX(100, wholeView(0), 800)).toBe(0)
    expect(xToTime(100, wholeView(0), 800)).toBe(0)
  })

  it('formats the clock to a tenth without rounding up past the length', () => {
    expect(formatClock(19_390)).toBe('0:19.3')
    expect(formatClock(0)).toBe('0:00.0')
    expect(formatClock(-40)).toBe('0:00.0')
    expect(formatClock(75_000)).toBe('1:15.0')
  })

  it('formats the Length readout as the clock shows the same length, never rounded up', () => {
    expect(formatLength(13_772.7)).toBe('13.7 s')
    expect(formatLength(16_516.7)).toBe('16.5 s')
    expect(formatLength(59_960)).toBe('59.9 s')
    expect(formatLength(75_600)).toBe('1:15')
    expect(formatLength(0)).toBe('0.0 s')
  })

  it('formats ruler labels as minutes and seconds', () => {
    expect(formatRulerLabel(5000)).toBe('0:05')
    expect(formatRulerLabel(60_000)).toBe('1:00')
  })
})

describe('a playhead or ruler drag', () => {
  const view = { start: 10_000, end: 20_000 }
  const take = { start: 0, end: 60_000 }
  /** A move from `lastX` to `x` on an 800 px track, 12.5 ms per px in `shown`. */
  const move = (lastX: number, x: number, shown = view, trim = take) => playheadDrag(x, lastX, shown, 800, trim, 60_000)

  it('puts the playhead under the pointer, and a press on a visible spot never scrolls', () => {
    expect(move(400, 400)).toEqual({ time: 15_000, view })
    expect(move(400, 400).view).toBe(view)
    expect(move(0, 0).time).toBe(10_000)
    expect(move(800, 800).time).toBe(20_000)
  })

  it('doesn’t scroll for a press just past an edge, only for a move further past it', () => {
    expect(move(-3, -3)).toEqual({ time: 10_000, view })
    expect(move(805, 805)).toEqual({ time: 20_000, view })
  })

  it('scrolls past the right edge by the part of a move that lies past it, keeping the playhead at that edge', () => {
    const { time, view: shown } = move(790, 880)
    expect(shown).toEqual({ start: 11_000, end: 21_000 })
    expect(time).toBe(21_000)
    expect(timeToX(time, shown, 800)).toBe(800)
  })

  it('scrolls past the left edge the same way', () => {
    const { time, view: shown } = move(10, -40)
    expect(shown).toEqual({ start: 9500, end: 19_500 })
    expect(time).toBe(9500)
    expect(timeToX(time, shown, 800)).toBe(0)
  })

  it('leaves the view where it is when the pointer comes back, past the edge or inside', () => {
    const scrolled = { start: 11_000, end: 21_000 }
    expect(move(880, 850, scrolled)).toEqual({ time: 21_000, view: scrolled })
    expect(move(850, 700, scrolled).view).toBe(scrolled)
    expect(move(850, 700, scrolled).time).toBe(19_750)
  })

  it('reaches further with every push past the edge, and not at all while the pointer is held still', () => {
    const first = move(790, 880).view
    const back = move(880, 700, first).view
    const second = move(700, 880, back).view
    expect([first, back, second]).toEqual([
      { start: 11_000, end: 21_000 },
      { start: 11_000, end: 21_000 },
      { start: 12_000, end: 22_000 }
    ])
    expect(move(880, 880, second).view).toBe(second)
  })

  it('maps every move through the view as it is now, so a wheel scroll made mid-drag stays', () => {
    const wheeled = { start: 30_000, end: 40_000 }
    expect(move(380, 400, wheeled)).toEqual({ time: 35_000, view: wheeled })
  })

  it('stops scrolling where the trim ends', () => {
    const trim = { start: 9000, end: 20_500 }
    const right = move(790, 900, view, trim)
    expect(right).toEqual({ time: 20_500, view: { start: 10_500, end: 20_500 } })
    expect(move(900, 1000, right.view, trim)).toEqual({ time: 20_500, view: right.view })
    expect(move(10, -500, view, trim)).toEqual({ time: 9000, view: { start: 9000, end: 19_000 } })
  })

  it('doesn’t scroll when the trim ends inside the view', () => {
    const { time, view: shown } = move(790, 900, view, { start: 0, end: 18_000 })
    expect(time).toBe(18_000)
    expect(shown).toBe(view)
  })

  it('stays inside the take at either end', () => {
    const atStart = { start: 0, end: 10_000 }
    expect(move(10, -300, atStart)).toEqual({ time: 0, view: atStart })
    const atEnd = { start: 50_000, end: 60_000 }
    expect(move(790, 1200, atEnd)).toEqual({ time: 60_000, view: atEnd })
  })

  it('brings the trim’s edge into view when the pointer is over a time the trim leaves out', () => {
    expect(move(400, 400, view, { start: 30_000, end: 60_000 })).toEqual({ time: 30_000, view: { start: 20_000, end: 30_000 } })
  })

  it('keeps a fractional trim start inside both the trim and the view it scrolls to', () => {
    const from = { start: 49855.374396699925, end: 53951.37429669993 }
    const trim = { start: 121463.23520301476, end: 1234568.5552834491 }
    const durationMs = 1234568.5552834491
    const { time, view: shown } = playheadDrag(600, 600, from, 1213, trim, durationMs)
    expect(time).toBe(trim.start)
    expect(shown.start).toBeLessThanOrEqual(time)
    expect(shown.end).toBeGreaterThanOrEqual(time)
    expect(timeToX(time, shown, 1213)).toBeLessThanOrEqual(1213)
    expect(timeToX(time, fitView(shown, durationMs), 1213)).toBeLessThanOrEqual(1213.5)
  })

  it('has nowhere to move without a width', () => {
    expect(playheadDrag(400, 400, view, 0, take, 60_000)).toEqual({ time: 10_000, view })
  })
})
