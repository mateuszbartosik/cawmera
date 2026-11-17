import { useSyncExternalStore } from 'react'
import type { AppState } from '../app/store'
import type { MenuSectionId } from './menu-model'
import type { MenuFocus } from './menu-nav'

export interface AppMenuState {
  open: boolean
  focus: MenuFocus
}

const SECTION_INDEX: Record<MenuSectionId, number> = { file: 0, edit: 1, view: 2, help: 3 }
const CLOSED: AppMenuState = { open: false, focus: { section: 0, item: null } }

let menu = CLOSED
const listeners = new Set<() => void>()

function setMenu(next: AppMenuState) {
  menu = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAppMenu(): AppMenuState {
  return useSyncExternalStore(subscribe, getAppMenu)
}

export function getAppMenu(): AppMenuState {
  return menu
}

export function toggleAppMenu() {
  setMenu(menu.open ? CLOSED : { open: true, focus: { section: SECTION_INDEX.file, item: null } })
}

export function openAppMenu(section: MenuSectionId) {
  setMenu({ open: true, focus: { section: SECTION_INDEX[section], item: 0 } })
}

export function setAppMenuFocus(focus: MenuFocus) {
  setMenu({ ...menu, focus })
}

export function closeAppMenu() {
  setMenu(CLOSED)
}

export function appMenuAllowed(s: Pick<AppState, 'capture'>): boolean {
  return s.capture.phase === 'idle'
}
