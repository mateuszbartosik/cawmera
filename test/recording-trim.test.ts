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
