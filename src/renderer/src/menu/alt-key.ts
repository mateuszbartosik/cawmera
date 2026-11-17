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
  pointerDown(): void
  pointerUp(): void
  interrupt(): void
}

const SECTION_BY_CODE: Partial<Record<string, MenuSectionId>> = { KeyF: 'file', KeyE: 'edit', KeyV: 'view', KeyH: 'help' }

const isLeftAlt = (event: AltKeyEvent) => event.key === 'Alt' && event.code === 'AltLeft'
const withoutOtherModifiers = (event: AltKeyEvent) => !event.ctrlKey && !event.metaKey && !event.shiftKey

export function altTracker(): AltTracker {
  let armed = false
  let pointerHeld = false
  return {
    keyDown(event) {
      if (event.key === 'Alt') {
        if (!event.repeat) armed = isLeftAlt(event) && withoutOtherModifiers(event) && !pointerHeld
        return null
      }
      if (!armed) return null
      armed = false
      const section = SECTION_BY_CODE[event.code]
      return section && event.altKey && withoutOtherModifiers(event) ? { kind: 'open', section } : null
    },
    keyUp(event) {
      if (!armed) return null
      armed = false
      return isLeftAlt(event) ? { kind: 'toggle' } : null
    },
    pointerDown() {
      armed = false
      pointerHeld = true
    },
    pointerUp() {
      pointerHeld = false
    },
    interrupt() {
      armed = false
      pointerHeld = false
    }
  }
}
