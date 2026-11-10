import { describe, expect, it } from 'vitest'
import { DEFAULT_RECORDING, type RecordingDoc } from '../src/renderer/src/recording/settings'
import type { RecordingEntry } from '../src/renderer/src/recording/registry'
import { takeViewFor } from '../src/renderer/src/recording/take-view'
import { wholeTake } from '../src/renderer/src/recording/timemap'
import type { Click, CursorSample } from '../src/renderer/src/recording/track'
import type { Trim } from '../src/renderer/src/recording/trim'

const frame = { width: 1920, height: 1080 }
const wanderAt = (t: number) => ({ x: 960 + 700 * Math.sin(t / 1700), y: 540 + 380 * Math.sin(t / 2300 + 1) })
const clickOnPath = (t: number): Click => ({ t, ...wanderAt(t), button: 'left', up: t + 90 })
const recording = (patch: Partial<RecordingDoc>): RecordingDoc => ({ ...DEFAULT_RECORDING, trim: { start: 1000, end: 11_000 }, pieces: wholeTake(12_000), zooms: null, ...patch })

function longEntry(durationMs: number): RecordingEntry {
  const samplesPerSecond = 120
  const cursor = Array.from({ length: (durationMs * samplesPerSecond) / 1000 }, (_, i): CursorSample => {
    const t = (i * 1000) / samplesPerSecond
    return { t, ...wanderAt(t), shape: 'arrow' }
  })
  const clicks = Array.from({ length: durationMs / 2000 }, (_, i) => clickOnPath(1000 + i * 2000))
  return { id: 'long', name: 'Recording', poster: null, track: { kind: 'monitor', ...frame, fps: 60, durationMs, scale: 1, cursor, clicks } }
}

describe('the take view of a long take', () => {
  it('rebuilds a ten-minute take in under 200 ms', () => {
    const long = longEntry(600_000)
    const trimmedTo = (trim: Trim) => recording({ trim, pieces: wholeTake(600_000) })
    const trims = [{ start: 0, end: 600_000 }, { start: 500, end: 599_000 }]
    takeViewFor(long, trimmedTo(trims[0]), null)
    const rebuildsMs = Array.from({ length: 5 }, (_, i) => {
      const started = performance.now()
      takeViewFor(long, trimmedTo(trims[(i + 1) % 2]), null)
      return performance.now() - started
    })
    expect(Math.min(...rebuildsMs)).toBeLessThan(200)
  })

  it('follows a drag of a ten-minute take’s trim start in steps under 200 ms', () => {
    const long = longEntry(600_000)
    const startingAt = (start: number) => recording({ trim: { start, end: 600_000 }, pieces: wholeTake(600_000) })
    takeViewFor(long, startingAt(0), null)
    const stepsMs = Array.from({ length: 5 }, (_, i) => {
      const started = performance.now()
      takeViewFor(long, startingAt((i + 1) * 40), null)
      return performance.now() - started
    })
    expect(Math.min(...stepsMs)).toBeLessThan(200)
  })
})
