import { describe, expect, it } from 'vitest'
import { movingShare, realtimeFactor, syntheticTake } from '../bench/fixture'
import { autoZooms } from '../src/renderer/src/recording/zooms'

const options = { seconds: 20, width: 2560, height: 1440, fps: 60 }

describe('the benchmark fixture', () => {
  it('makes the same take every time', () => expect(syntheticTake(options)).toEqual(syntheticTake(options)))

  it('moves the cursor about half the time and clicks in three groups', () => {
    const take = syntheticTake(options)
    expect(movingShare(take)).toBeGreaterThan(0.4)
    expect(movingShare(take)).toBeLessThan(0.7)
    expect(autoZooms(take.clicks, take, { start: 0, end: take.durationMs }, 'calm')).toHaveLength(3)
  })

  it('keeps every click on the cursor path and inside the frame', () => {
    const take = syntheticTake(options)
    for (const click of take.clicks) {
      const sample = take.cursor.find((row) => row.t === click.t)
      expect(sample && { x: sample.x, y: sample.y }).toEqual({ x: click.x, y: click.y })
      expect(click.x).toBeGreaterThan(0)
      expect(click.x).toBeLessThan(options.width)
      expect(click.y).toBeGreaterThan(0)
      expect(click.y).toBeLessThan(options.height)
    }
  })
})

describe('moving share', () => {
  const rows = (positions: number[]) => positions.map((x, i) => ({ t: i * 50, x, y: 0, shape: 'arrow' as const }))
  const track = (positions: number[]) => ({ kind: 'monitor' as const, width: 100, height: 100, fps: 60, durationMs: 400, scale: 1, cursor: rows(positions), clicks: [] })

  it('counts the 100 ms windows where the cursor travels at least 2 px', () => {
    expect(movingShare(track([0, 0, 0, 0, 0, 10, 20, 30, 30]))).toBe(0.5)
    expect(movingShare(track([0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(0)
  })
})

describe('real-time factor', () => {
  it('reports how many times real time an export took', () => expect(realtimeFactor(38_000, 91_200)).toBeCloseTo(2.4))
})
