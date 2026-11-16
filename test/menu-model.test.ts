import { describe, expect, it } from 'vitest'
import { appMenu, showsMenuButton, type MenuSection, type MenuSectionId } from '../src/renderer/src/menu/menu-model'

const lines = (section: MenuSection) =>
  section.entries.map((entry) => (entry.kind === 'separator' ? '—' : entry.shortcut ? `${entry.label} · ${entry.shortcut}` : entry.label))
const windows = appMenu({ platform: 'win32', recording: true })
const section = (sections: readonly MenuSection[], id: MenuSectionId) => sections.find((s) => s.id === id)!

describe('appMenu', () => {
  it('has File, Edit, View and Help', () => {
    expect(windows.map((s) => s.label)).toEqual(['File', 'Edit', 'View', 'Help'])
  })

  it('lists File on Windows', () => {
    expect(lines(section(windows, 'file'))).toEqual([
      'New shot · Ctrl+N',
      'Open image… · Ctrl+O',
      'Screenshot… · Ctrl+Shift+2',
      'Record…',
      '—',
      'Open draft…',
      'Save draft… · Ctrl+Shift+D',
      '—',
      'Copy image · Ctrl+Shift+C',
      'Export… · Ctrl+S',
      'Export all… · Ctrl+Shift+S',
      '—',
      'Quit'
    ])
  })

  it('leaves out Record when recording is unsupported and changes nothing else', () => {
    const without = lines(section(appMenu({ platform: 'win32', recording: false }), 'file'))
    expect(without).not.toContain('Record…')
    expect(without).toEqual(lines(section(windows, 'file')).filter((line) => line !== 'Record…'))
  })

  it('shows the Quit shortcut on Linux', () => {
    expect(lines(section(appMenu({ platform: 'linux', recording: true }), 'file')).at(-1)).toBe('Quit · Ctrl+Q')
  })

  it('lists Edit', () => {
    expect(lines(section(windows, 'edit'))).toEqual(['Undo · Ctrl+Z', 'Redo · Ctrl+Shift+Z'])
  })

  it('lists View', () => {
    expect(lines(section(windows, 'view'))).toEqual([
      'Zoom to fit all · Shift+1',
      'Zoom to shot · Shift+2',
      'Zoom to 100% · Ctrl+0',
      'Zoom in · Ctrl+=',
      'Zoom out · Ctrl+-',
      '—',
      'Previous shot · Ctrl+PageUp',
      'Next shot · Ctrl+PageDown',
      '—',
      'Light / dark · Ctrl+Shift+L',
      'House style · Ctrl+Alt+H',
      '—',
      'Developer tools · Ctrl+Shift+I'
    ])
  })

  it('lists Help', () => {
    expect(lines(section(windows, 'help'))).toEqual(['About Cawmera'])
  })

  it('maps every item to its command', () => {
    const commands = Object.fromEntries(
      windows.flatMap((s) => s.entries.flatMap((entry) => (entry.kind === 'item' ? [[entry.label, entry.command]] : [])))
    )
    expect(commands).toEqual({
      'New shot': 'new-shot',
      'Open image…': 'open',
      'Screenshot…': 'capture',
      'Record…': 'record',
      'Open draft…': 'open-draft',
      'Save draft…': 'save-draft',
      'Copy image': 'copy',
      'Export…': 'export',
      'Export all…': 'export-all',
      Quit: 'quit',
      Undo: 'undo',
      Redo: 'redo',
      'Zoom to fit all': 'fit',
      'Zoom to shot': 'fit-shot',
      'Zoom to 100%': 'zoom-100',
      'Zoom in': 'zoom-in',
      'Zoom out': 'zoom-out',
      'Previous shot': 'previous-shot',
      'Next shot': 'next-shot',
      'Light / dark': 'toggle-theme',
      'House style': 'toggle-house-style',
      'Developer tools': 'toggle-dev-tools',
      'About Cawmera': 'about'
    })
  })

  it('has no text-field items', () => {
    const labels = windows.flatMap((s) => s.entries.flatMap((entry) => (entry.kind === 'item' ? [entry.label] : [])))
    for (const label of ['Cut', 'Copy', 'Paste', 'Select all']) expect(labels).not.toContain(label)
  })
})

describe('showsMenuButton', () => {
  it('is true on Windows and Linux, false on macOS and in the browser', () => {
    expect(showsMenuButton('win32')).toBe(true)
    expect(showsMenuButton('linux')).toBe(true)
    expect(showsMenuButton('darwin')).toBe(false)
    expect(showsMenuButton(null)).toBe(false)
  })
})
