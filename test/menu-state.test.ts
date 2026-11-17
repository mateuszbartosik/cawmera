import { beforeEach, describe, expect, it } from 'vitest'
import type { CaptureState } from '../src/renderer/src/app/store'
import { appMenuAllowed, closeAppMenu, getAppMenu, openAppMenu, setAppMenuFocus, toggleAppMenu } from '../src/renderer/src/menu/menu-state'

beforeEach(() => closeAppMenu())

describe('the app menu', () => {
  it('toggles open on File without opening it, then closed', () => {
    toggleAppMenu()
    expect(getAppMenu()).toEqual({ open: true, focus: { section: 0, item: null } })
    toggleAppMenu()
    expect(getAppMenu().open).toBe(false)
  })

  it('opens a section with its first item focused', () => {
    openAppMenu('view')
    expect(getAppMenu()).toEqual({ open: true, focus: { section: 2, item: 0 } })
  })

  it('keeps the focus it is given', () => {
    toggleAppMenu()
    setAppMenuFocus({ section: 1, item: 1 })
    expect(getAppMenu().focus).toEqual({ section: 1, item: 1 })
  })
})

describe('appMenuAllowed', () => {
  const during = (phase: CaptureState['phase']) => appMenuAllowed({ capture: { phase, remaining: 0 } })

  it('allows the menu only while no capture runs', () => {
    expect(during('idle')).toBe(true)
    for (const phase of ['picking', 'countdown', 'grabbing', 'recording'] as const) expect(during(phase)).toBe(false)
  })
})
