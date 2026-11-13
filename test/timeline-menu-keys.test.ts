import { describe, expect, it } from 'vitest'
import { menuKeyAction } from '../src/renderer/src/timeline/menu-keys'

describe('keys in an open menu', () => {
  it('move the focus with the arrows, wrapping around, and with Home and End', () => {
    expect(menuKeyAction('ArrowDown', 1, 4)).toEqual({ kind: 'focus', index: 2 })
    expect(menuKeyAction('ArrowDown', 3, 4)).toEqual({ kind: 'focus', index: 0 })
    expect(menuKeyAction('ArrowUp', 0, 4)).toEqual({ kind: 'focus', index: 3 })
    expect(menuKeyAction('Home', 2, 4)).toEqual({ kind: 'focus', index: 0 })
    expect(menuKeyAction('End', 0, 4)).toEqual({ kind: 'focus', index: 3 })
  })

  it('pick the focused item with Space or Enter', () => {
    expect(menuKeyAction(' ', 2, 4)).toEqual({ kind: 'pick', index: 2 })
    expect(menuKeyAction('Enter', 0, 4)).toEqual({ kind: 'pick', index: 0 })
    expect(menuKeyAction(' ', -1, 4)).toBeNull()
    expect(menuKeyAction('Enter', -1, 4)).toBeNull()
  })

  it('close the menu with Escape or Tab', () => {
    expect(menuKeyAction('Escape', 1, 4)).toEqual({ kind: 'close' })
    expect(menuKeyAction('Tab', 1, 4)).toEqual({ kind: 'close' })
  })

  it('do nothing in the menu with any other key, editing shortcuts included', () => {
    for (const key of ['s', 'S', 'Delete', 'Backspace', 'c', 'r', 'ArrowLeft', 'ArrowRight']) expect(menuKeyAction(key, 1, 4)).toBeNull()
  })
})
