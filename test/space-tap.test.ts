import { describe, expect, it } from 'vitest'
import { stepSpaceTap } from '../src/renderer/src/canvas/space-tap'

const plain = { typing: false, modified: false }
const press = (...events: Parameters<typeof stepSpaceTap>[1][]) => {
  let armed = false
  let toggled = false
  for (const event of events) {
    const step = stepSpaceTap(armed, event)
    armed = step.armed
    toggled = step.toggle
  }
  return toggled
}
const down = { kind: 'down', repeat: false, ...plain } as const
const up = { kind: 'up', playable: true, ...plain } as const

describe('tapping Space', () => {
  it('toggles on a clean press and release', () => expect(press(down, up)).toBe(true))
  it('does not toggle after a key repeat', () => expect(press(down, { ...down, repeat: true }, up)).toBe(false))
  it('does not toggle once the press became a pan', () => expect(press(down, { kind: 'panStarted' }, up)).toBe(false))
  it('does not toggle while typing', () => {
    expect(press({ ...down, typing: true }, up)).toBe(false)
    expect(press(down, { ...up, typing: true })).toBe(false)
  })
  it('does not toggle with a modifier held', () => {
    expect(press({ ...down, modified: true }, up)).toBe(false)
    expect(press(down, { ...up, modified: true })).toBe(false)
  })
  it('does not toggle where nothing plays', () => expect(press(down, { ...up, playable: false })).toBe(false))
  it('does not toggle on a release without a press', () => expect(press(up)).toBe(false))
})
