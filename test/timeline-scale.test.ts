import { describe, expect, it } from 'vitest'
import { dragTrim, formatClock, formatRulerLabel, tickStep, timeToX, xToTime } from '../src/renderer/src/timeline/scale'

describe('timeline scale', () => {
  it('maps time to x and back', () => {
    expect(timeToX(2500, 10_000, 800)).toBe(200)
    expect(xToTime(200, 10_000, 800)).toBe(2500)
    expect(xToTime(-5, 10_000, 800)).toBe(0)
    expect(xToTime(900, 10_000, 800)).toBe(10_000)
  })

  it('spaces ruler labels at least 64 px apart', () => {
    expect(tickStep(48_600, 812)).toBe(5000)
    expect(tickStep(10 * 60_000, 812)).toBe(60000)
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
    expect(timeToX(100, 0, 800)).toBe(0)
    expect(xToTime(100, 0, 800)).toBe(0)
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
