import { describe, expect, it } from 'vitest'
import { springFor, springStep } from '../src/renderer/src/recording/spring'

describe('springStep', () => {
  it('settles a step from rest within 2% at its settle time, and not long before', () => {
    for (const damping of [1, 0.8]) {
      const at = (t: number) => springStep(0, 0, 1, springFor(900, damping), t)[0]
      expect(Math.abs(1 - at(900))).toBeLessThanOrEqual(0.02 + 1e-9)
      expect(Math.abs(1 - at(500))).toBeGreaterThan(0.02)
    }
  })

  it('never overshoots when critically damped, and by under 2% at 0.8', () => {
    const peak = (damping: number) => Math.max(...Array.from({ length: 3000 }, (_, t) => springStep(0, 0, 1, springFor(900, damping), t)[0]))
    expect(peak(1)).toBeLessThanOrEqual(1)
    expect(peak(0.8)).toBeLessThan(1.02)
  })

  it.each([1, 0.8])('lands in the same state in one step or a hundred (damping %s)', (damping) => {
    const spring = springFor(500, damping)
    let state: [number, number] = [0, 0]
    for (let i = 0; i < 100; i++) state = springStep(state[0], state[1], 1, spring, 3)
    const once = springStep(0, 0, 1, spring, 300)
    expect(state[0]).toBeCloseTo(once[0], 9)
    expect(state[1]).toBeCloseTo(once[1], 9)
  })

  it.each([1, 0.8])('stays where it is over a zero time step, as at a cut’s seam (damping %s)', (damping) => {
    const [value, velocity] = springStep(0.3, 0.002, 1, springFor(500, damping), 0)
    expect(value).toBeCloseTo(0.3, 12)
    expect(velocity).toBeCloseTo(0.002, 12)
  })
})

describe('springFor', () => {
  it('refuses a damping it has no settle time for', () => {
    expect(() => springFor(900, 0)).toThrow(RangeError)
    expect(() => springFor(900, 1.2)).toThrow(RangeError)
  })
})
