import { describe, expect, it } from 'vitest'
import { cameraAt } from '../src/renderer/src/recording/camera'

const frame = { width: 1920, height: 1080 }
const z = (start: number, end: number, depth: number, x: number, y: number) => ({ start, end, depth, focus: { x, y } })

describe('cameraAt', () => {
  it('is wide with no zooms', () => expect(cameraAt(5000, [], frame, 'calm')).toEqual({ depth: 1, focus: { x: 960, y: 540 } }))

  it('is fully in during the hold and wide after the zoom-out', () => {
    const zooms = [z(3000, 6000, 2, 500, 400)]
    expect(cameraAt(4000, zooms, frame, 'calm')).toEqual({ depth: 2, focus: { x: 500, y: 400 } })
    expect(cameraAt(6000 + 700, zooms, frame, 'calm').depth).toBe(1)
    expect(cameraAt(3000 - 700, zooms, frame, 'calm').depth).toBe(1)
  })

  it('is halfway (in log depth) in the middle of the zoom-in', () => {
    expect(cameraAt(3000 - 350, [z(3000, 6000, 2, 500, 400)], frame, 'calm').depth).toBeCloseTo(Math.SQRT2, 5)
  })

  it('moves straight between close zooms without going wide', () => {
    const zooms = [z(3000, 5000, 2, 400, 400), z(5200, 8000, 2, 1500, 700)]
    const mid = cameraAt(5100, zooms, frame, 'quick')
    expect(mid.depth).toBeCloseTo(2, 5)
    expect(mid.focus.x).toBeCloseTo(950, 0)
  })

  it('zooms in over 700 ms when calm and 400 ms when quick', () => {
    const zooms = [z(3000, 6000, 2, 500, 400)]
    expect(cameraAt(2500, zooms, frame, 'quick').depth).toBe(1)
    expect(cameraAt(2500, zooms, frame, 'calm').depth).toBeGreaterThan(1)
  })

  it('goes wide between zooms when the gap is at least 2T + 300', () => {
    const zooms = [z(3000, 5000, 2, 400, 400), z(5000 + 1100, 9000, 2, 1500, 700)]
    expect(cameraAt(5550, zooms, frame, 'quick')).toEqual({ depth: 1, focus: { x: 960, y: 540 } })
  })

  it('stretches a short gap to a window of at least T centred on it', () => {
    const zooms = [z(3000, 5000, 2, 400, 400), z(5100, 8000, 2, 1500, 700)]
    expect(cameraAt(4650, zooms, frame, 'calm').focus.x).toBe(400)
    expect(cameraAt(4800, zooms, frame, 'calm').focus.x).toBeGreaterThan(400)
    expect(cameraAt(5050, zooms, frame, 'calm').focus.x).toBeCloseTo(950, 5)
    expect(cameraAt(5450, zooms, frame, 'calm').focus.x).toBe(1500)
  })
})
