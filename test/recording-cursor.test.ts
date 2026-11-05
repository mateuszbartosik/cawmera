import { describe, expect, it } from 'vitest'
import { buildCursorPath, cursorAt } from '../src/renderer/src/recording/cursor'
import type { RecordingTrack } from '../src/renderer/src/recording/track'

const frame = { width: 1920, height: 1080 }
const zigzag = Array.from({ length: 120 }, (_, i) => ({ t: i * 16, x: 500 + (i % 2) * 6 + i * 4, y: 300, shape: 'arrow' as const }))
const track = (extra: Partial<RecordingTrack> = {}): RecordingTrack => ({ kind: 'window', width: 1920, height: 1080, fps: 60,
  durationMs: 2000, scale: 1, cursor: zigzag, clicks: [{ t: 800, x: 700, y: 300, button: 'left', up: 880 }], ...extra })

describe('cursor path', () => {
  it('follows raw samples with smoothing 0', () => {
    const path = buildCursorPath(track(), 0)
    expect(cursorAt(path, 16, false, frame)!.x).toBeCloseTo(510)
  })

  it('sits exactly on every click at its time, whatever the smoothing', () => {
    for (const smoothing of [0.3, 0.6, 1]) {
      const at = cursorAt(buildCursorPath(track(), smoothing), 800, false, frame)!
      expect(Math.hypot(at.x - 700, at.y - 300)).toBeLessThan(0.5)
    }
  })

  it('sits on a click that falls between two samples', () => {
    const clicks = [{ t: 805, x: 650, y: 280, button: 'left' as const, up: null }]
    const at = cursorAt(buildCursorPath(track({ clicks }), 0.5), 805, false, frame)!
    expect(Math.hypot(at.x - 650, at.y - 280)).toBeLessThan(0.5)
  })

  it('pins two close clicks independently', () => {
    const clicks = [
      { t: 800, x: 700, y: 300, button: 'left' as const, up: null },
      { t: 900, x: 900, y: 500, button: 'left' as const, up: null }
    ]
    const path = buildCursorPath(track({ clicks }), 1)
    for (const click of clicks) {
      const at = cursorAt(path, click.t, false, frame)!
      expect(Math.hypot(at.x - click.x, at.y - click.y)).toBeLessThan(0.5)
    }
  })

  it('irons out jitter', () => {
    const path = buildCursorPath(track(), 1)
    const steps = path.x.slice(10, 40).map((x, i, a) => (i ? x - a[i - 1] : 4))
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(2)
  })

  it('ignores shape flickers under 100 ms', () => {
    const cursor = zigzag.map((s) => (s.t >= 320 && s.t < 384 ? { ...s, shape: 'hand' as const } : s))
    expect(cursorAt(buildCursorPath(track({ cursor }), 0), 350, false, frame)!.shape).toBe('arrow')
  })

  it('keeps shape changes that last', () => {
    const cursor = zigzag.map((s) => (s.t >= 320 ? { ...s, shape: 'hand' as const } : s))
    expect(cursorAt(buildCursorPath(track({ cursor }), 0), 600, false, frame)!.shape).toBe('hand')
  })

  it('is not drawn when hidden or far outside the frame', () => {
    const hidden = zigzag.map((s) => ({ ...s, shape: null }))
    expect(cursorAt(buildCursorPath(track({ cursor: hidden }), 0), 500, false, frame)).toBeNull()
    const outside = zigzag.map((s) => ({ ...s, x: -100 }))
    expect(cursorAt(buildCursorPath(track({ cursor: outside }), 0), 500, false, frame)).toBeNull()
  })

  it('is still drawn just outside the frame edge', () => {
    const edge = zigzag.map((s) => ({ ...s, x: -20 }))
    expect(cursorAt(buildCursorPath(track({ cursor: edge }), 0), 500, false, frame)).not.toBeNull()
  })

  it('fades out when still and comes back just before moving', () => {
    const still = [...Array.from({ length: 300 }, (_, i) => ({ t: i * 16, x: 800, y: 400, shape: 'arrow' as const })),
      { t: 4900, x: 900, y: 400, shape: 'arrow' as const }]
    const path = buildCursorPath(track({ cursor: still, clicks: [], durationMs: 5000 }), 0)
    expect(cursorAt(path, 3000, true, frame)).toBeNull()
    expect(cursorAt(path, 4890, true, frame)!.opacity).toBeGreaterThan(0)
    expect(cursorAt(path, 3000, false, frame)!.opacity).toBe(1)
  })

  it('stays visible around a click while still', () => {
    const still = Array.from({ length: 300 }, (_, i) => ({ t: i * 16, x: 800, y: 400, shape: 'arrow' as const }))
    const clicks = [{ t: 3000, x: 800, y: 400, button: 'left' as const, up: 3050 }]
    const path = buildCursorPath(track({ cursor: still, clicks, durationMs: 5000 }), 0)
    expect(cursorAt(path, 3100, true, frame)!.opacity).toBe(1)
    expect(cursorAt(path, 2900, true, frame)!.opacity).toBeGreaterThan(0)
  })
})
