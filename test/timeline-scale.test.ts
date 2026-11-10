import { describe, expect, it } from 'vitest'
import {
  dragTrim,
  fitView,
  formatClock,
  formatRulerLabel,
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
    expect(dragTrim({ start: 0, end: 9000 }, 'start', 8800, 10_000)).toEqual({ start: 8500, end: 9000 })
    expect(dragTrim({ start: 0, end: 9000 }, 'end', 12_000, 10_000)).toEqual({ start: 0, end: 10_000 })
  })

  it('keeps the other handle where it is', () => {
    expect(dragTrim({ start: 1000, end: 9000 }, 'start', 3000, 10_000)).toEqual({ start: 3000, end: 9000 })
    expect(dragTrim({ start: 1000, end: 9000 }, 'end', 1200, 10_000)).toEqual({ start: 1000, end: 1500 })
    expect(dragTrim({ start: 1000, end: 9000 }, 'start', -400, 10_000)).toEqual({ start: 0, end: 9000 })
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

  it('formats ruler labels as minutes and seconds', () => {
    expect(formatRulerLabel(5000)).toBe('0:05')
    expect(formatRulerLabel(60_000)).toBe('1:00')
  })
})
