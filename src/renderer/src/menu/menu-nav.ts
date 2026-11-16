import type { MenuCommand } from '../../../shared/types'
import { menuKeyAction } from '../timeline/menu-keys'
import type { MenuSection } from './menu-model'

/** `item` indexes the section's entries (never a separator); null means focus sits on the first level. */
export interface MenuFocus {
  section: number
  item: number | null
}
export type MenuNavAction = { kind: 'focus'; focus: MenuFocus } | { kind: 'run'; command: MenuCommand } | { kind: 'close' }

const focusAction = (section: number, item: number | null): MenuNavAction => ({ kind: 'focus', focus: { section, item } })

export function menuNavKey(key: string, focus: MenuFocus, sections: readonly MenuSection[]): MenuNavAction | null {
  if (key === 'Tab') return { kind: 'close' }
  return focus.item === null ? firstLevelKey(key, focus.section, sections) : submenuKey(key, focus.section, focus.item, sections)
}

function firstLevelKey(key: string, section: number, sections: readonly MenuSection[]): MenuNavAction | null {
  switch (key) {
    case 'ArrowRight':
    case 'Enter':
    case ' ':
      return focusAction(section, 0)
    case 'Escape':
      return { kind: 'close' }
    default: {
      const move = menuKeyAction(key, section, sections.length)
      return move?.kind === 'focus' ? focusAction(move.index, null) : null
    }
  }
}

function submenuKey(key: string, section: number, item: number, sections: readonly MenuSection[]): MenuNavAction | null {
  const entries = sections[section].entries
  const selectable = entries.flatMap((entry, index) => (entry.kind === 'item' ? [index] : []))
  switch (key) {
    case 'ArrowLeft':
    case 'Escape':
      return focusAction(section, null)
    case 'Enter':
    case ' ': {
      const entry = entries[item]
      return entry.kind === 'item' ? { kind: 'run', command: entry.command } : null
    }
    default: {
      const move = menuKeyAction(key, selectable.indexOf(item), selectable.length)
      return move?.kind === 'focus' ? focusAction(section, selectable[move.index]) : null
    }
  }
}
