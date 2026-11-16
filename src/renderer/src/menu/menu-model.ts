import type { MenuCommand } from '../../../shared/types'

export type MenuSectionId = 'file' | 'edit' | 'view' | 'help'
export type MenuEntry = { kind: 'item'; label: string; shortcut: string | null; command: MenuCommand } | { kind: 'separator' }
export interface MenuSection {
  id: MenuSectionId
  label: string
  entries: readonly MenuEntry[]
}

const item = (label: string, shortcut: string | null, command: MenuCommand): MenuEntry => ({ kind: 'item', label, shortcut, command })
const separator: MenuEntry = { kind: 'separator' }

export function appMenu({ platform, recording }: { platform: string; recording: boolean }): readonly MenuSection[] {
  return [
    {
      id: 'file',
      label: 'File',
      entries: [
        item('New shot', 'Ctrl+N', 'new-shot'),
        item('Open image…', 'Ctrl+O', 'open'),
        item('Screenshot…', 'Ctrl+Shift+2', 'capture'),
        ...(recording ? [item('Record…', null, 'record')] : []),
        separator,
        item('Open draft…', null, 'open-draft'),
        item('Save draft…', 'Ctrl+Shift+D', 'save-draft'),
        separator,
        item('Copy image', 'Ctrl+Shift+C', 'copy'),
        item('Export…', 'Ctrl+S', 'export'),
        item('Export all…', 'Ctrl+Shift+S', 'export-all'),
        separator,
        item('Quit', platform === 'linux' ? 'Ctrl+Q' : null, 'quit')
      ]
    },
    {
      id: 'edit',
      label: 'Edit',
      entries: [item('Undo', 'Ctrl+Z', 'undo'), item('Redo', 'Ctrl+Shift+Z', 'redo')]
    },
    {
      id: 'view',
      label: 'View',
      entries: [
        item('Zoom to fit all', 'Shift+1', 'fit'),
        item('Zoom to shot', 'Shift+2', 'fit-shot'),
        item('Zoom to 100%', 'Ctrl+0', 'zoom-100'),
        item('Zoom in', 'Ctrl+=', 'zoom-in'),
        item('Zoom out', 'Ctrl+-', 'zoom-out'),
        separator,
        item('Previous shot', 'Ctrl+PageUp', 'previous-shot'),
        item('Next shot', 'Ctrl+PageDown', 'next-shot'),
        separator,
        item('Light / dark', 'Ctrl+Shift+L', 'toggle-theme'),
        item('House style', 'Ctrl+Alt+H', 'toggle-house-style'),
        separator,
        item('Developer tools', 'Ctrl+Shift+I', 'toggle-dev-tools')
      ]
    },
    { id: 'help', label: 'Help', entries: [item('About Cawmera', null, 'about')] }
  ]
}

export function showsMenuButton(platform: string | null): boolean {
  return platform === 'win32' || platform === 'linux'
}
