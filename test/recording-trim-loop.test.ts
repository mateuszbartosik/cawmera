import { describe, expect, it } from 'vitest'
import { timeMapOf, wholeTake, type Piece, type Rate } from '../src/renderer/src/recording/timemap'
import { clampToTrim, playbackStart, rateAt, stepAt } from '../src/renderer/src/recording/trim-loop'

const piece = (start: number, end: number, rate: Rate = 1, cut = false): Piece => ({ start, end, rate, cut })
const trim = { start: 0, end: 10_000 }
const map = timeMapOf(trim, [piece(0, 2000), piece(2000, 4000, 4), piece(4000, 6000, 1, true), piece(6000, 9000), piece(9000, 10_000, 1, true)])
const trimmed = timeMapOf({ start: 1000, end: 9000 }, wholeTake(10_000))

describe('trim loop', () => {
  it('plays each piece at its rate, jumps over cuts and ends at a trailing cut', () => {
    expect([stepAt(1000, map), stepAt(3000, map)]).toEqual([{ kind: 'play', rate: 1 }, { kind: 'play', rate: 4 }])
    expect(stepAt(4100, map)).toEqual({ kind: 'jump', to: 6000 })
    expect(stepAt(9100, map)).toEqual({ kind: 'end' })
  })

  it('hands a boundary to the piece that starts there', () => {
    expect(stepAt(2000, map)).toEqual({ kind: 'play', rate: 4 })
    expect(stepAt(4000, map)).toEqual({ kind: 'jump', to: 6000 })
    expect(stepAt(9000, map)).toEqual({ kind: 'end' })
  })

  it('jumps to the first kept moment from before it, and ends when nothing is kept', () => {
    expect(stepAt(200, trimmed)).toEqual({ kind: 'jump', to: 1000 })
    expect(stepAt(9000, trimmed)).toEqual({ kind: 'end' })
    expect(stepAt(0, timeMapOf(trim, [piece(0, 10_000, 1, true)]))).toEqual({ kind: 'end' })
  })

  it('names the rate a moment plays at, and 1 outside the kept pieces', () => {
    expect(rateAt(3000, map)).toBe(4)
    expect(rateAt(6000, map)).toBe(1)
    expect(rateAt(4500, map)).toBe(1)
  })

  it('starts over from the first kept moment, and plays on past a cut', () => {
    expect(playbackStart(9500, map, false)).toBe(0)
    expect(playbackStart(4500, map, false)).toBe(6000)
    expect(playbackStart(1500, map, false)).toBe(1500)
  })

  it('starts over at or near the last kept moment, before the first, and after the video ended on its own', () => {
    expect(playbackStart(9000, trimmed, false)).toBe(1000)
    expect(playbackStart(8970, trimmed, false)).toBe(1000)
    expect(playbackStart(200, trimmed, false)).toBe(1000)
    expect(playbackStart(8700, trimmed, true)).toBe(1000)
    expect(playbackStart(4000, trimmed, false)).toBe(4000)
  })

  it('keeps seeks inside the trim', () => {
    expect(clampToTrim(500, { start: 1000, end: 9000 })).toBe(1000)
    expect(clampToTrim(5000, { start: 1000, end: 9000 })).toBe(5000)
    expect(clampToTrim(20_000, { start: 1000, end: 9000 })).toBe(9000)
  })
})
