import { describe, expect, it } from 'vitest'
import {
  mapTrack, outputFrameTimes, outputToSource, preRollToOutput, snapToOutput, sourceToOutput, timeMapOf, wholeTake, RATES, type Piece, type Rate
} from '../src/renderer/src/recording/timemap'
import type { RecordingTrack } from '../src/renderer/src/recording/track'

const piece = (start: number, end: number, rate: Rate = 1, cut = false): Piece => ({ start, end, rate, cut })
const cutMiddle = [piece(0, 4000), piece(4000, 6000, 1, true), piece(6000, 10_000)]

describe('time map', () => {
  it('maps a trimmed take onto output time', () => {
    const map = timeMapOf({ start: 1000, end: 9000 }, wholeTake(10_000))
    expect(map.outputMs).toBe(8000)
    expect([sourceToOutput(map, 1000), sourceToOutput(map, 9000), sourceToOutput(map, 500)]).toEqual([0, 8000, null])
    expect(outputToSource(map, 500)).toBe(1500)
  })
  it('skips cut pieces and collapses them to a seam', () => {
    const map = timeMapOf({ start: 0, end: 10_000 }, cutMiddle)
    expect(map.outputMs).toBe(8000)
    expect(sourceToOutput(map, 5000)).toBeNull()
    expect(snapToOutput(map, 5000)).toBe(4000)
    expect([outputToSource(map, 3999), outputToSource(map, 4000)]).toEqual([3999, 6000])
  })
  it('plays sped-up pieces faster', () => {
    const map = timeMapOf({ start: 0, end: 10_000 }, [piece(0, 2000), piece(2000, 6000, 4), piece(6000, 10_000)])
    expect(map.outputMs).toBe(7000)
    expect(sourceToOutput(map, 4000)).toBe(2500)
    expect([outputToSource(map, 2500), outputToSource(map, 3000)]).toEqual([4000, 6000])
  })
  it('round-trips every kept source time', () => {
    const map = timeMapOf({ start: 500, end: 9500 }, [piece(0, 2000), piece(2000, 3000, 1, true), piece(3000, 6000, 8), piece(6000, 10_000)])
    for (let s = 500; s < 9500; s += 37) {
      const o = sourceToOutput(map, s)
      if (o !== null) expect(outputToSource(map, o)).toBeCloseTo(s, 6)
    }
  })
  it('is monotonic through every seam, rate and cut', () => {
    const pieces = [piece(0, 1000, 2), piece(1000, 2000, 1, true), piece(2000, 4000, 4), piece(4000, 5000, 1, true), piece(5000, 9000, 8)]
    const map = timeMapOf({ start: 300, end: 8700 }, pieces)
    let previousSnap = -1
    let previousSource = -1
    for (let s = 0; s <= 10_000; s += 7) {
      const snapped = snapToOutput(map, s)
      expect(snapped).toBeGreaterThanOrEqual(previousSnap)
      previousSnap = snapped
    }
    for (let o = -50; o <= map.outputMs + 50; o += 3) {
      const source = outputToSource(map, o)
      expect(source).toBeGreaterThanOrEqual(previousSource)
      previousSource = source
    }
  })
  it('maps seams to the start of the next span, and the final end to the output length', () => {
    const map = timeMapOf({ start: 0, end: 10_000 }, [piece(0, 4000, 2), piece(4000, 10_000)])
    expect(map.outputMs).toBe(8000)
    expect(sourceToOutput(map, 3999)).toBeCloseTo(1999.5, 6)
    expect(sourceToOutput(map, 4000)).toBe(2000)
    expect(sourceToOutput(map, 10_000)).toBe(8000)
    expect(outputToSource(map, 8000)).toBe(10_000)
    expect(outputToSource(map, 99_999)).toBe(10_000)
    expect(outputToSource(map, -5)).toBe(0)
  })
  it('treats a trailing cut as the end of the video', () => {
    const map = timeMapOf({ start: 0, end: 10_000 }, [piece(0, 6000), piece(6000, 10_000, 1, true)])
    expect(map.outputMs).toBe(6000)
    expect(sourceToOutput(map, 6000)).toBe(6000)
    expect(sourceToOutput(map, 7000)).toBeNull()
    expect(snapToOutput(map, 7000)).toBe(6000)
    expect(snapToOutput(map, 10_000)).toBe(6000)
    expect(outputToSource(map, 6000)).toBe(6000)
  })
  it('snaps a leading cut or a time before the trim to the start', () => {
    const map = timeMapOf({ start: 2000, end: 9000 }, [piece(0, 3000, 1, true), piece(3000, 10_000)])
    expect(snapToOutput(map, 100)).toBe(0)
    expect(snapToOutput(map, 2500)).toBe(0)
    expect(snapToOutput(map, 9500)).toBe(map.outputMs)
    expect(sourceToOutput(map, 3000)).toBe(0)
  })
  it('keeps the same length at every rate', () => {
    for (const rate of RATES) {
      const map = timeMapOf({ start: 0, end: 8000 }, [piece(0, 8000, rate)])
      expect(map.outputMs).toBe(8000 / rate)
      expect(sourceToOutput(map, 4000)).toBe(4000 / rate)
      expect(outputToSource(map, 1000)).toBe(1000 * rate)
    }
  })
  it('has no output when everything is cut or trimmed away', () => {
    const allCut = timeMapOf({ start: 1000, end: 9000 }, [piece(0, 10_000, 1, true)])
    const trimmedOut = timeMapOf({ start: 5000, end: 5000 }, wholeTake(10_000))
    for (const map of [allCut, trimmedOut]) {
      expect(map.spans).toEqual([])
      expect(map.outputMs).toBe(0)
      expect(sourceToOutput(map, 5000)).toBeNull()
      expect(snapToOutput(map, 5000)).toBe(0)
      expect(outputFrameTimes(map, 60)).toEqual([0])
    }
    expect(outputToSource(allCut, 123)).toBe(1000)
    expect(outputToSource(trimmedOut, 0)).toBe(5000)
  })
  it('steps export frames through output time', () => {
    const map = timeMapOf({ start: 0, end: 1000 }, [piece(0, 1000, 4)])
    const frames = outputFrameTimes(map, 60)
    expect(frames).toHaveLength(15)
    expect(outputToSource(map, frames[1])).toBeCloseTo(66.667, 2)
    expect(outputFrameTimes(timeMapOf({ start: 0, end: 10 }, wholeTake(10)), 60)).toEqual([0])
  })
  it('moves a track into output time and the cropped frame', () => {
    const track: RecordingTrack = { kind: 'monitor', width: 1920, height: 1080, fps: 60, durationMs: 10_000, scale: 1,
      cursor: [{ t: 1000, x: 100, y: 100, shape: 'arrow' }, { t: 5000, x: 500, y: 500, shape: 'arrow' }, { t: 7000, x: 700, y: 700, shape: 'hand' }],
      clicks: [{ t: 3900, x: 390, y: 390, button: 'left', up: 4200 }, { t: 5900, x: 600, y: 600, button: 'left', up: 6100 },
        { t: 7000, x: 700, y: 700, button: 'left', up: 7050 }] }
    const mapped = mapTrack(track, timeMapOf({ start: 0, end: 10_000 }, cutMiddle), { x: 100, y: 50, w: 800, h: 600 })
    expect(mapped).toMatchObject({ width: 800, height: 600, durationMs: 8000 })
    expect(mapped.cursor.map((s) => [s.t, s.x, s.y])).toEqual([[1000, 0, 50], [5000, 600, 650]])
    expect(mapped.clicks.map((c) => [c.t, c.up])).toEqual([[3900, 4000], [5000, 5050]])
  })
  it('never maps a later source time to an earlier output time', () => {
    const pieces = [piece(0, 1000, 2), piece(1000, 2000, 1, true), piece(2000, 4000, 4), piece(4000, 5000, 1, true), piece(5000, 9000, 8)]
    const map = timeMapOf({ start: 300, end: 8700 }, pieces)
    let previous = -1
    for (let s = 0; s <= 10_000; s += 7) {
      const o = sourceToOutput(map, s)
      if (o === null) continue
      expect(o).toBeGreaterThanOrEqual(previous)
      previous = o
    }
  })
  it('round-trips every output time through a map with cuts and speed-ups', () => {
    const map = timeMapOf({ start: 500, end: 9500 }, [piece(0, 2000), piece(2000, 3000, 1, true), piece(3000, 6000, 8), piece(6000, 10_000, 2)])
    for (let o = 0; o <= map.outputMs; o += 3) expect(sourceToOutput(map, outputToSource(map, o))).toBeCloseTo(o, 6)
    expect(sourceToOutput(map, outputToSource(map, map.outputMs))).toBe(map.outputMs)
  })
  it('ends the video at a cut when the trim ends inside it', () => {
    const map = timeMapOf({ start: 0, end: 5000 }, [piece(0, 4000), piece(4000, 7000, 1, true), piece(7000, 10_000)])
    expect(map.outputMs).toBe(4000)
    expect(map.spans).toHaveLength(1)
    expect([sourceToOutput(map, 4000), sourceToOutput(map, 4500), sourceToOutput(map, 7500)]).toEqual([4000, null, null])
    expect([snapToOutput(map, 4500), snapToOutput(map, 8000)]).toEqual([4000, 4000])
    expect(outputToSource(map, 4000)).toBe(4000)
    expect(outputFrameTimes(map, 60)).toHaveLength(240)
  })
  it('joins two adjacent cuts into one seam', () => {
    const map = timeMapOf({ start: 0, end: 8000 }, [piece(0, 2000), piece(2000, 3000, 1, true), piece(3000, 5000, 1, true), piece(5000, 8000)])
    expect(map.outputMs).toBe(5000)
    expect([sourceToOutput(map, 2500), sourceToOutput(map, 3000), sourceToOutput(map, 4999), sourceToOutput(map, 5000)]).toEqual([null, null, null, 2000])
    expect([snapToOutput(map, 2000), snapToOutput(map, 3000), snapToOutput(map, 4999)]).toEqual([2000, 2000, 2000])
    expect([outputToSource(map, 1999), outputToSource(map, 2000)]).toEqual([1999, 5000])
  })
  it('runs time before the video on below output 0 at the first span’s rate, and snaps the rest', () => {
    const map = timeMapOf({ start: 2000, end: 9000 }, [piece(0, 5000, 2), piece(5000, 6000, 1, true), piece(6000, 10_000)])
    expect([preRollToOutput(map, 0), preRollToOutput(map, 1500), preRollToOutput(map, 2000)]).toEqual([-1000, -250, 0])
    expect([preRollToOutput(map, 4000), preRollToOutput(map, 5500), preRollToOutput(map, 9500)]).toEqual([1000, 1500, map.outputMs])
    expect(preRollToOutput(timeMapOf({ start: 0, end: 4000 }, [piece(0, 4000, 1, true)]), 100)).toBe(0)
  })
  it('maps a track onto nothing when nothing plays', () => {
    const track: RecordingTrack = { kind: 'monitor', width: 1920, height: 1080, fps: 60, durationMs: 4000, scale: 1,
      cursor: [{ t: 1000, x: 100, y: 100, shape: 'arrow' }], clicks: [{ t: 2000, x: 300, y: 300, button: 'left', up: 2100 }] }
    const mapped = mapTrack(track, timeMapOf({ start: 0, end: 4000 }, [piece(0, 4000, 1, true)]), { x: 0, y: 0, w: 1920, h: 1080 })
    expect(mapped).toMatchObject({ width: 1920, height: 1080, durationMs: 0, cursor: [], clicks: [] })
  })
  it('keeps an unreleased click unreleased and shortens a release inside a speed-up', () => {
    const track: RecordingTrack = { kind: 'window', width: 100, height: 100, fps: 60, durationMs: 4000, scale: 1, cursor: [],
      clicks: [{ t: 1000, x: 1, y: 2, button: 'right', up: null }, { t: 2000, x: 3, y: 4, button: 'left', up: 2400 }] }
    const mapped = mapTrack(track, timeMapOf({ start: 0, end: 4000 }, [piece(0, 1500), piece(1500, 4000, 8)]), { x: 0, y: 0, w: 100, h: 100 })
    expect(mapped.clicks.map((c) => [c.t, c.up])).toEqual([[1000, null], [1562.5, 1612.5]])
  })
})
