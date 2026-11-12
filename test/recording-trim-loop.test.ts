import { describe, expect, it } from 'vitest'
import { timeMapOf, wholeTake, type Piece, type Rate } from '../src/renderer/src/recording/timemap'
import { clampToTrim, frameMsOf, lastKeptFrameTime, playbackStart, rateAt, stepAt } from '../src/renderer/src/recording/trim-loop'

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

  it('plays a frame that reaches into a kept span, so landing just before a jump target does not jump again', () => {
    const frame = frameMsOf(60)
    expect(stepAt(6000 - 10, map, frame)).toEqual({ kind: 'play', rate: 1 })
    expect(stepAt(2000 - 10, map, frame)).toEqual({ kind: 'play', rate: 1 })
    expect(stepAt(6000 - frame - 1, map, frame)).toEqual({ kind: 'jump', to: 6000 })
    expect(stepAt(6000 - frame, map, frame)).toEqual({ kind: 'jump', to: 6000 })
  })

  it('jumps from a frame wholly inside a cut, and ends from one wholly inside a trailing cut', () => {
    const frame = frameMsOf(60)
    expect(stepAt(4100, map, frame)).toEqual({ kind: 'jump', to: 6000 })
    expect(stepAt(9000 + 5, map, frame)).toEqual({ kind: 'end' })
    expect(stepAt(9000 - 10, map, frame)).toEqual({ kind: 'play', rate: 1 })
  })

  it('steps over consecutive cuts and a cut at the start, and ends when only cuts remain', () => {
    const cuts = timeMapOf(trim, [piece(0, 1000, 1, true), piece(1000, 2000, 1, true), piece(2000, 4000, 8), piece(4000, 5000, 1, true), piece(5000, 6000, 1, true), piece(6000, 10_000)])
    const frame = frameMsOf(30)
    expect(stepAt(0, cuts, frame)).toEqual({ kind: 'jump', to: 2000 })
    expect(stepAt(1500, cuts, frame)).toEqual({ kind: 'jump', to: 2000 })
    expect(stepAt(3000, cuts, frame)).toEqual({ kind: 'play', rate: 8 })
    expect(stepAt(4500, cuts, frame)).toEqual({ kind: 'jump', to: 6000 })
    expect(playbackStart(0, cuts, false)).toBe(2000)
    expect(playbackStart(5500, cuts, false)).toBe(6000)
    expect(rateAt(500, cuts)).toBe(1)
    expect(rateAt(3000, cuts)).toBe(8)
    expect(rateAt(5500, cuts)).toBe(1)
  })

  it('has nothing to play without kept spans', () => {
    const empty = timeMapOf({ start: 2000, end: 3000 }, [piece(0, 10_000, 1, true)])
    expect(stepAt(2500, empty, frameMsOf(60))).toEqual({ kind: 'end' })
    expect(playbackStart(5000, empty, false)).toBe(2000)
    expect(rateAt(2500, empty)).toBe(1)
  })

  it('stops in the middle of the frame holding the last kept moment, before a trailing cut', () => {
    const frame = frameMsOf(60)
    const gridEnd = timeMapOf(trim, [piece(0, 9000), piece(9000, 10_000, 1, true)])
    expect(lastKeptFrameTime(gridEnd, frame)).toBeCloseTo(539.5 * frame)
    expect(lastKeptFrameTime(gridEnd, frame)).toBeLessThan(9000)
    const offGridEnd = timeMapOf(trim, [piece(0, 9010), piece(9010, 10_000, 1, true)])
    expect(lastKeptFrameTime(offGridEnd, frame)).toBeCloseTo(540.5 * frame)
    const tinySpan = timeMapOf(trim, [piece(0, 5012, 1, true), piece(5012, 5015), piece(5015, 10_000, 1, true)])
    expect(lastKeptFrameTime(tinySpan, frame)).toBe(5012)
    expect(lastKeptFrameTime(timeMapOf(trim, [piece(0, 10_000, 1, true)]), frame)).toBe(0)
  })
})
