export type MenuKeyAction = { kind: 'focus'; index: number } | { kind: 'pick'; index: number } | { kind: 'close' }

/** What a key does in an open menu of `count` items with item `focused` focused (-1: none); null for a key it does nothing with. */
export function menuKeyAction(key: string, focused: number, count: number): MenuKeyAction | null {
  switch (key) {
    case 'ArrowDown':
      return { kind: 'focus', index: (focused + 1) % count }
    case 'ArrowUp':
      return { kind: 'focus', index: (focused - 1 + count) % count }
    case 'Home':
      return { kind: 'focus', index: 0 }
    case 'End':
      return { kind: 'focus', index: count - 1 }
    case ' ':
    case 'Enter':
      return focused === -1 ? null : { kind: 'pick', index: focused }
    case 'Escape':
    case 'Tab':
      return { kind: 'close' }
    default:
      return null
  }
}
