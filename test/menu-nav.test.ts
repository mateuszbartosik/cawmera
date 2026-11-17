import { describe, expect, it } from 'vitest'
import { appMenu } from '../src/renderer/src/menu/menu-model'
import { menuNavKey, passesThroughOpenMenu } from '../src/renderer/src/menu/menu-nav'

const sections = appMenu({ platform: 'win32', recording: true })
const focusAt = (section: number, item: number | null) => ({ kind: 'focus', focus: { section, item } })
const firstLevel = (section: number) => ({ section, item: null })
const inFile = (item: number) => ({ section: 0, item })

describe('menuNavKey on the first level', () => {
  it('moves between sections and wraps', () => {
    expect(menuNavKey('ArrowDown', firstLevel(0), sections)).toEqual(focusAt(1, null))
    expect(menuNavKey('ArrowUp', firstLevel(0), sections)).toEqual(focusAt(3, null))
    expect(menuNavKey('Home', firstLevel(2), sections)).toEqual(focusAt(0, null))
    expect(menuNavKey('End', firstLevel(0), sections)).toEqual(focusAt(3, null))
  })

  it('goes into a submenu', () => {
    for (const key of ['ArrowRight', 'Enter', ' ']) expect(menuNavKey(key, firstLevel(2), sections)).toEqual(focusAt(2, 0))
  })

  it('gives nothing for ArrowLeft', () => {
    expect(menuNavKey('ArrowLeft', firstLevel(1), sections)).toBeNull()
  })
})

describe('menuNavKey in a submenu', () => {
  it('skips separators and wraps', () => {
    expect(menuNavKey('ArrowDown', inFile(3), sections)).toEqual(focusAt(0, 5))
    expect(menuNavKey('ArrowUp', inFile(5), sections)).toEqual(focusAt(0, 3))
    expect(menuNavKey('ArrowDown', inFile(12), sections)).toEqual(focusAt(0, 0))
    expect(menuNavKey('Home', inFile(7), sections)).toEqual(focusAt(0, 0))
    expect(menuNavKey('End', inFile(7), sections)).toEqual(focusAt(0, 12))
  })

  it('runs the focused item', () => {
    for (const key of ['Enter', ' ']) expect(menuNavKey(key, inFile(3), sections)).toEqual({ kind: 'run', command: 'record' })
  })

  it('backs out to the first level', () => {
    for (const key of ['ArrowLeft', 'Escape']) expect(menuNavKey(key, inFile(3), sections)).toEqual(focusAt(0, null))
  })
})

describe('menuNavKey closing and unused keys', () => {
  it('closes on Escape from the first level and on Tab anywhere', () => {
    expect(menuNavKey('Escape', firstLevel(1), sections)).toEqual({ kind: 'close' })
    expect(menuNavKey('Tab', firstLevel(1), sections)).toEqual({ kind: 'close' })
    expect(menuNavKey('Tab', inFile(3), sections)).toEqual({ kind: 'close' })
  })

  it('ignores other keys', () => {
    for (const key of ['s', 'Delete', 'a']) {
      expect(menuNavKey(key, firstLevel(0), sections)).toBeNull()
      expect(menuNavKey(key, inFile(3), sections)).toBeNull()
    }
  })
})

describe('passesThroughOpenMenu', () => {
  const keyDown = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods
  })

  it('lets Ctrl and Meta shortcuts through to the window', () => {
    expect(passesThroughOpenMenu(keyDown('L', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(passesThroughOpenMenu(keyDown('s', { ctrlKey: true }))).toBe(true)
    expect(passesThroughOpenMenu(keyDown('z', { ctrlKey: true }))).toBe(true)
    expect(passesThroughOpenMenu(keyDown('k', { metaKey: true }))).toBe(true)
  })

  it('keeps bare modifiers in the menu, even with Ctrl or Meta held', () => {
    expect(passesThroughOpenMenu(keyDown('Control', { ctrlKey: true }))).toBe(false)
    expect(passesThroughOpenMenu(keyDown('Shift', { shiftKey: true }))).toBe(false)
    expect(passesThroughOpenMenu(keyDown('Shift', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(passesThroughOpenMenu(keyDown('Meta', { metaKey: true }))).toBe(false)
    expect(passesThroughOpenMenu(keyDown('Alt', { ctrlKey: true, altKey: true }))).toBe(false)
    expect(passesThroughOpenMenu(keyDown('AltGraph', { ctrlKey: true, altKey: true }))).toBe(false)
  })

  it('keeps plain keys and Alt letters in the menu', () => {
    for (const key of [' ', 's', 'Delete', 'Enter']) expect(passesThroughOpenMenu(keyDown(key))).toBe(false)
    expect(passesThroughOpenMenu(keyDown('f', { altKey: true }))).toBe(false)
  })
})
