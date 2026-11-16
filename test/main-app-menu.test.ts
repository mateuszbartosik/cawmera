import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { nativeMenuTemplate } from '../src/main/app-menu'

describe('nativeMenuTemplate', () => {
  it('has no menu on Windows and Linux', () => {
    expect(nativeMenuTemplate('win32', vi.fn())).toBeNull()
    expect(nativeMenuTemplate('linux', vi.fn())).toBeNull()
  })

  it('keeps the whole menu on macOS', () => {
    const template = nativeMenuTemplate('darwin', vi.fn())!
    expect(template[0].role).toBe('appMenu')
    expect(template.slice(1, 4).map((entry) => entry.label)).toEqual(['File', 'Edit', 'View'])
    expect(template[4].role).toBe('help')
    const fileLabels = (template[1].submenu as MenuItemConstructorOptions[]).map((entry) => entry.label)
    expect(fileLabels).toContain('Screenshot…')
    expect(fileLabels).toContain('Open draft…')
    const editRoles = (template[2].submenu as MenuItemConstructorOptions[]).map((entry) => entry.role)
    expect(editRoles).toEqual(expect.arrayContaining(['cut', 'copy', 'paste', 'selectAll']))
  })

  it('sends the command of a clicked item', () => {
    const send = vi.fn()
    const file = nativeMenuTemplate('darwin', send)![1].submenu as MenuItemConstructorOptions[]
    file.find((entry) => entry.label === 'New shot')!.click!({} as never, undefined, {} as never)
    expect(send).toHaveBeenCalledWith('new-shot')
  })
})
