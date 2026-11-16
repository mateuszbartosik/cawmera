import { describe, expect, it } from 'vitest'
import { altTracker, type AltKeyEvent } from '../src/renderer/src/menu/alt-key'

const press = (key: string, code: string, mods: Partial<AltKeyEvent> = {}): AltKeyEvent => ({
  key,
  code,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  ...mods
})
const altDown = () => press('Alt', 'AltLeft', { altKey: true })
const altUp = () => press('Alt', 'AltLeft')

describe('altTracker', () => {
  it('toggles on Alt pressed and released alone', () => {
    const tracker = altTracker()
    expect(tracker.keyDown(altDown())).toBeNull()
    expect(tracker.keyUp(altUp())).toEqual({ kind: 'toggle' })
  })

  it('toggles once for a held Alt', () => {
    const tracker = altTracker()
    tracker.keyDown(altDown())
    expect(tracker.keyDown({ ...altDown(), repeat: true })).toBeNull()
    expect(tracker.keyDown({ ...altDown(), repeat: true })).toBeNull()
    expect(tracker.keyUp(altUp())).toEqual({ kind: 'toggle' })
    expect(tracker.keyUp(altUp())).toBeNull()
  })

  it('opens a section on an Alt mnemonic and ignores the release', () => {
    const sections = { KeyF: 'file', KeyE: 'edit', KeyV: 'view', KeyH: 'help' } as const
    for (const [code, section] of Object.entries(sections)) {
      const tracker = altTracker()
      tracker.keyDown(altDown())
      expect(tracker.keyDown(press('x', code, { altKey: true }))).toEqual({ kind: 'open', section })
      expect(tracker.keyUp(altUp())).toBeNull()
    }
  })

  it('leaves Alt+Shift to Windows', () => {
    const tracker = altTracker()
    tracker.keyDown(altDown())
    expect(tracker.keyDown(press('F', 'KeyF', { altKey: true, shiftKey: true }))).toBeNull()
    expect(tracker.keyUp(altUp())).toBeNull()

    tracker.keyDown(altDown())
    tracker.keyDown(press('Shift', 'ShiftLeft', { altKey: true, shiftKey: true }))
    tracker.keyUp(press('Shift', 'ShiftLeft', { altKey: true }))
    expect(tracker.keyUp(altUp())).toBeNull()
  })

  it('ignores AltGr', () => {
    const tracker = altTracker()
    expect(tracker.keyDown(press('Control', 'ControlLeft', { ctrlKey: true }))).toBeNull()
    expect(tracker.keyDown(press('AltGraph', 'AltRight', { altKey: true, ctrlKey: true }))).toBeNull()
    expect(tracker.keyDown(press('ę', 'KeyE', { altKey: true, ctrlKey: true }))).toBeNull()
    expect(tracker.keyUp(press('AltGraph', 'AltRight', { ctrlKey: true }))).toBeNull()
    expect(tracker.keyUp(press('Control', 'ControlLeft'))).toBeNull()
  })

  it('ignores Ctrl+Alt+H and the Alt release after it', () => {
    const tracker = altTracker()
    tracker.keyDown(press('Control', 'ControlLeft', { ctrlKey: true }))
    tracker.keyDown(press('Alt', 'AltLeft', { altKey: true, ctrlKey: true }))
    expect(tracker.keyDown(press('h', 'KeyH', { altKey: true, ctrlKey: true }))).toBeNull()
    expect(tracker.keyUp(press('Alt', 'AltLeft', { ctrlKey: true }))).toBeNull()
  })

  it('ignores the release after an interrupt', () => {
    const tracker = altTracker()
    tracker.keyDown(altDown())
    tracker.interrupt()
    expect(tracker.keyUp(altUp())).toBeNull()
  })

  it('ignores the release after another key', () => {
    const tracker = altTracker()
    tracker.keyDown(altDown())
    expect(tracker.keyDown(press('Tab', 'Tab', { altKey: true }))).toBeNull()
    expect(tracker.keyUp(altUp())).toBeNull()
  })

  it('works again after a cancelled Alt', () => {
    const tracker = altTracker()
    tracker.keyDown(altDown())
    tracker.keyDown(press('Tab', 'Tab', { altKey: true }))
    tracker.keyUp(altUp())
    tracker.keyDown(altDown())
    expect(tracker.keyUp(altUp())).toEqual({ kind: 'toggle' })
  })
})
