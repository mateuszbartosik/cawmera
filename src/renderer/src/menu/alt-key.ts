import type { MenuSectionId } from './menu-model'

export interface AltKeyEvent {
  key: string
  code: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  repeat: boolean
}
export type AltAction = { kind: 'toggle' } | { kind: 'open'; section: MenuSectionId }
export interface AltTracker {
  keyDown(event: AltKeyEvent): AltAction | null
  keyUp(event: AltKeyEvent): AltAction | null
  interrupt(): void
}

const SECTION_BY_CODE: Partial<Record<string, MenuSectionId>> = { KeyF: 'file', KeyE: 'edit', KeyV: 'view', KeyH: 'help' }

export function altTracker(): AltTracker {
  let armed = false
  return {
    keyDown(event) {
      if (event.key === 'Alt') {
        if (!event.repeat && !event.ctrlKey && !event.metaKey && !event.shiftKey) armed = true
        return null
      }
      if (!armed) return null
      armed = false
      const section = SECTION_BY_CODE[event.code]
      const plainAlt = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
      return section && plainAlt ? { kind: 'open', section } : null
    },
    keyUp(event) {
      if (event.key !== 'Alt' || !armed) return null
      armed = false
      return { kind: 'toggle' }
    },
    interrupt() {
      armed = false
    }
  }
}
