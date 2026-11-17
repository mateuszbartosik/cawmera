import type { MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/types'

export function nativeMenuTemplate(platform: NodeJS.Platform, send: (command: MenuCommand) => void): MenuItemConstructorOptions[] | null {
  if (platform !== 'darwin') return null
  const item = (label: string, accelerator: string, command: MenuCommand): MenuItemConstructorOptions => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: () => send(command)
  })
  return [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        item('New shot', 'CmdOrCtrl+N', 'new-shot'),
        item('Open image…', 'CmdOrCtrl+O', 'open'),
        item('Screenshot…', 'CmdOrCtrl+Shift+2', 'capture'),
        { type: 'separator' },
        { label: 'Open draft…', click: () => send('open-draft') },
        item('Save draft…', 'CmdOrCtrl+Shift+D', 'save-draft'),
        { type: 'separator' },
        item('Copy image', 'CmdOrCtrl+Shift+C', 'copy'),
        item('Export…', 'CmdOrCtrl+S', 'export'),
        item('Export all…', 'CmdOrCtrl+Shift+S', 'export-all'),
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        item('Undo', 'CmdOrCtrl+Z', 'undo'),
        item('Redo', 'CmdOrCtrl+Shift+Z', 'redo'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        item('Zoom to fit all', 'Shift+1', 'fit'),
        item('Zoom to shot', 'Shift+2', 'fit-shot'),
        item('Zoom to 100%', 'CmdOrCtrl+0', 'zoom-100'),
        item('Zoom in', 'CmdOrCtrl+=', 'zoom-in'),
        item('Zoom out', 'CmdOrCtrl+-', 'zoom-out'),
        { type: 'separator' },
        item('Previous shot', 'CmdOrCtrl+PageUp', 'previous-shot'),
        item('Next shot', 'CmdOrCtrl+PageDown', 'next-shot'),
        { type: 'separator' },
        item('Light / dark', 'CmdOrCtrl+Shift+L', 'toggle-theme'),
        item('House style', 'CmdOrCtrl+Alt+H', 'toggle-house-style'),
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    { role: 'help', submenu: [{ label: 'About Cawmera', click: () => send('about') }] }
  ]
}
