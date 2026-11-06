import { describe, expect, it } from 'vitest'
import { parseTrack, stopClickOf, withoutStopClick, type Click, type RecordingTrack } from '../src/renderer/src/recording/track'

const raw = {
  version: 1,
  kind: 'window',
  width: 1920,
  height: 1080,
  fps: 60,
  durationMs: 3000,
  scale: 1.14,
  shapes: ['arrow', 'hand'],
  cursor: [
    [16.7, 10, 20, 1],
    [0, 5, 5, 0],
    [33.3, 11, 21, -1]
  ],
  clicks: [
    [1520, 812.5, 400.25, 0, 1610],
    [900, 1, 2, 1, -1]
  ]
}

describe('parseTrack', () => {
  it('parses rows into samples and clicks, sorted by time', () => {
    const track = parseTrack(raw)
    expect(track.cursor.map((s) => s.t)).toEqual([0, 16.7, 33.3])
    expect(track.cursor[1]).toEqual({ t: 16.7, x: 10, y: 20, shape: 'hand' })
    expect(track.cursor[2].shape).toBeNull()
    expect(track.clicks[0]).toEqual({ t: 900, x: 1, y: 2, button: 'right', up: null })
    expect(track.clicks[1]).toEqual({ t: 1520, x: 812.5, y: 400.25, button: 'left', up: 1610 })
  })

  it('maps unknown shape names to other', () => {
    expect(parseTrack({ ...raw, shapes: ['arrow', 'zoom-in'] }).cursor[1].shape).toBe('other')
  })

  it('rejects anything that is not a version 1 track', () => {
    const invalid = [null, {}, { ...raw, version: 2 }, { ...raw, width: 0 }, { ...raw, cursor: 'x' }, { ...raw, clicks: [[1, 2]] }]
    for (const bad of invalid) expect(() => parseTrack(bad)).toThrow('Not a Cawmera recording track')
  })

  it('drops rows with non-finite numbers', () => {
    const track = parseTrack({ ...raw, cursor: [[0, 1, 2, 0], [1, null, 2, 0]], clicks: [[1, 2, 3, 0, -1], [null, 2, 3, 0, -1]] })
    expect(track.cursor).toHaveLength(1)
    expect(track.clicks).toHaveLength(1)
  })
})

describe('the click that stopped a take', () => {
  const take = (clicks: Click[]): RecordingTrack =>
    ({ kind: 'monitor', width: 1920, height: 1080, fps: 60, durationMs: 10_000, scale: 1, cursor: [], clicks })
  const next: Click = { t: 6000, x: 1000, y: 700, button: 'left', up: 6080 }
  const taskbar: Click = { t: 9200, x: 900, y: 1060, button: 'left', up: null }

  it('drops the taskbar click that stopped the take', () => {
    expect(withoutStopClick(take([next, taskbar]), 'window').clicks).toEqual([next])
  })

  it('keeps a last click from before the final second', () => {
    const earlier = { ...taskbar, t: 8900 }
    expect(withoutStopClick(take([next, earlier]), 'window').clicks).toEqual([next, earlier])
  })

  it('keeps every click when the take stopped another way', () => {
    for (const stoppedBy of ['shortcut', 'target-gone'] as const) {
      expect(withoutStopClick(take([next, taskbar]), stoppedBy).clicks).toEqual([next, taskbar])
    }
  })

  it('leaves a take without clicks as it is', () => {
    expect(withoutStopClick(take([]), 'window').clicks).toEqual([])
  })

  it('is found only for a taskbar stop, in the final second', () => {
    expect(stopClickOf(take([next, taskbar]), 'window')).toEqual(taskbar)
    expect(stopClickOf(take([next, { ...taskbar, t: 8900 }]), 'window')).toBeNull()
    expect(stopClickOf(take([next, taskbar]), 'shortcut')).toBeNull()
    expect(stopClickOf(take([]), 'window')).toBeNull()
  })
})
