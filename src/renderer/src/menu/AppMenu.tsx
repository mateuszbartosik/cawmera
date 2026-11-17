import { CaretRight, List } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { MenuCommand } from '@shared/types'
import { MENU_BUTTON_SIZE, PANEL_GAP } from '../canvas/view'
import { bridge } from '../platform/bridge'
import { useRecordingSupport } from '../recording/support'
import type { Point } from '../render/geometry'
import { cn, IconButton } from '../ui/controls'
import { appMenu, showsMenuButton, type MenuSection } from './menu-model'
import { menuNavKey, type MenuFocus } from './menu-nav'
import { closeAppMenu, getAppMenu, setAppMenuFocus, toggleAppMenu, useAppMenu } from './menu-state'

interface AppMenuProps {
  onRun: (command: MenuCommand) => void
}

const platform = bridge?.platform ?? null
const ITEM_HEIGHT = 24
const SUBMENU_GRACE_MS = 300
const PANEL = 'flex flex-col rounded-lg border border-(--tc-line) bg-(--tc-panel) p-1 shadow-[var(--tc-panel-shadow)] backdrop-blur-[40px]'

const itemClass = (highlighted: boolean) =>
  cn(
    'flex items-center justify-between gap-8 rounded-md px-2 text-left text-xs whitespace-nowrap text-(--tc-fg) tabular-nums outline-none',
    highlighted && 'bg-(--tc-control)'
  )

const pointOf = (event: { clientX: number; clientY: number }): Point => ({ x: event.clientX, y: event.clientY })

function insideTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const side = (from: Point, to: Point) => Math.sign((to.x - from.x) * (p.y - from.y) - (to.y - from.y) * (p.x - from.x))
  const sides = [side(a, b), side(b, c), side(c, a)]
  return !(sides.includes(1) && sides.includes(-1))
}

export function AppMenu({ onRun }: AppMenuProps) {
  return platform && showsMenuButton(platform) ? <MenuButton platform={platform} onRun={onRun} /> : null
}

function MenuButton({ platform, onRun }: AppMenuProps & { platform: string }) {
  const { open, focus } = useAppMenu()
  const sections = appMenu({ platform, recording: useRecordingSupport()?.ok === true })
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOnPressOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeAppMenu()
    }
    window.addEventListener('pointerdown', closeOnPressOutside, true)
    window.addEventListener('blur', closeAppMenu)
    return () => {
      window.removeEventListener('pointerdown', closeOnPressOutside, true)
      window.removeEventListener('blur', closeAppMenu)
    }
  }, [open])

  return (
    <div ref={rootRef} className="absolute z-30" style={{ left: PANEL_GAP, top: PANEL_GAP }} onMouseDown={(event) => event.preventDefault()}>
      <div
        className="flex items-center justify-center rounded-lg border border-(--tc-line) bg-(--tc-panel) text-(--tc-fg) shadow-[var(--tc-panel-shadow)] backdrop-blur-[40px] backdrop-saturate-150"
        style={{ width: MENU_BUTTON_SIZE, height: MENU_BUTTON_SIZE }}
      >
        <IconButton label="Menu" shortcut="Alt" side="bottom" active={open} aria-haspopup="menu" aria-expanded={open} onClick={toggleAppMenu}>
          <List size={15} />
        </IconButton>
      </div>
      {open && <MenuPanels sections={sections} focus={focus} onRun={onRun} />}
    </div>
  )
}

interface MenuPanelsProps extends AppMenuProps {
  sections: readonly MenuSection[]
  focus: MenuFocus
}

function MenuPanels({ sections, focus, onRun }: MenuPanelsProps) {
  const [pointerOpened, setPointerOpened] = useState<number | null>(null)
  const expanded = focus.item !== null || pointerOpened === focus.section ? focus.section : null
  const entryRefs = useRef<(HTMLButtonElement | null)[]>([])
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const submenuRef = useRef<HTMLDivElement>(null)
  const focusBeforeOpen = useRef<Element | null>(null)
  const entryUnderPointer = useRef<number | null>(null)
  const aim = useRef<{ from: Point; until: number } | null>(null)
  const waiting = useRef<{ section: number; timer: number } | null>(null)

  const returnFocus = () => {
    const previous = focusBeforeOpen.current
    focusBeforeOpen.current = null
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
  }

  useLayoutEffect(() => {
    focusBeforeOpen.current = document.activeElement
    return returnFocus
  }, [])

  useLayoutEffect(() => {
    const target = focus.item === null ? entryRefs.current[focus.section] : itemRefs.current[focus.item]
    target?.focus({ preventScroll: true })
  }, [focus.section, focus.item])

  useEffect(() => () => window.clearTimeout(waiting.current?.timer), [])

  const moveFocus = (section: number, item: number | null) => {
    const current = getAppMenu().focus
    if (current.section !== section || current.item !== item) setAppMenuFocus({ section, item })
  }

  const stopWaiting = () => {
    window.clearTimeout(waiting.current?.timer)
    waiting.current = null
  }

  const showEntry = (section: number) => {
    stopWaiting()
    aim.current = null
    setPointerOpened(section)
    moveFocus(section, null)
  }

  const headingIntoSubmenu = (point: Point) => {
    const submenu = submenuRef.current?.getBoundingClientRect()
    const intent = aim.current
    if (!submenu || !intent || performance.now() > intent.until) return false
    return insideTriangle(point, intent.from, { x: submenu.left, y: submenu.top }, { x: submenu.left, y: submenu.bottom })
  }

  const waitBeforeShowing = (section: number) => {
    if (waiting.current?.section === section) return
    stopWaiting()
    const graceLeft = Math.max(0, (aim.current?.until ?? 0) - performance.now())
    waiting.current = { section, timer: window.setTimeout(() => showEntry(section), graceLeft) }
  }

  const pointerOverEntry = (section: number, point: Point) => {
    const arrived = entryUnderPointer.current !== section
    entryUnderPointer.current = section
    if (!arrived && getAppMenu().focus.section === section) return
    if (section !== expanded && headingIntoSubmenu(point)) waitBeforeShowing(section)
    else showEntry(section)
  }

  const pointerLeftEntry = (section: number, point: Point) => {
    if (entryUnderPointer.current === section) entryUnderPointer.current = null
    if (waiting.current?.section === section) stopWaiting()
    if (section === expanded) aim.current = { from: point, until: performance.now() + SUBMENU_GRACE_MS }
  }

  const pointerReachedSubmenu = () => {
    stopWaiting()
    aim.current = null
  }

  const run = (command: MenuCommand) => {
    closeAppMenu()
    returnFocus()
    onRun(command)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const current = getAppMenu().focus
    if (event.key === 'Escape' && current.item === null && pointerOpened === current.section) {
      event.preventDefault()
      setPointerOpened(null)
      return
    }
    const action = menuNavKey(event.key, current, sections)
    if (!action) return
    event.preventDefault()
    if (action.kind === 'run') run(action.command)
    else if (action.kind === 'close') closeAppMenu()
    else {
      setPointerOpened(null)
      setAppMenuFocus(action.focus)
    }
  }

  return (
    <div className="absolute top-full left-0 mt-1" onKeyDown={onKeyDown}>
      <div role="menu" aria-label="Menu" className={cn(PANEL, 'min-w-32')}>
        {sections.map((section, index) => (
          <button
            key={section.id}
            ref={(entry) => {
              entryRefs.current[index] = entry
            }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={expanded === index}
            tabIndex={focus.section === index && focus.item === null ? 0 : -1}
            className={itemClass(focus.section === index)}
            style={{ height: ITEM_HEIGHT }}
            onPointerMove={(event) => pointerOverEntry(index, pointOf(event))}
            onPointerLeave={(event) => pointerLeftEntry(index, pointOf(event))}
            onClick={() => showEntry(index)}
          >
            {section.label}
            <CaretRight size={10} className="text-(--tc-value)" />
          </button>
        ))}
      </div>
      {expanded !== null && (
        <div
          key={sections[expanded].id}
          ref={submenuRef}
          role="menu"
          aria-label={sections[expanded].label}
          className={cn(PANEL, 'absolute left-full ml-1 min-w-40')}
          style={{ top: expanded * ITEM_HEIGHT }}
          onPointerMove={pointerReachedSubmenu}
        >
          {sections[expanded].entries.map((entry, index) =>
            entry.kind === 'separator' ? (
              <div key={index} role="separator" className="mx-1 my-1 h-px bg-(--tc-divider)" />
            ) : (
              <button
                key={entry.command}
                ref={(item) => {
                  itemRefs.current[index] = item
                }}
                type="button"
                role="menuitem"
                tabIndex={focus.item === index ? 0 : -1}
                className={itemClass(focus.item === index)}
                style={{ height: ITEM_HEIGHT }}
                onPointerMove={() => moveFocus(expanded, index)}
                onClick={() => run(entry.command)}
              >
                {entry.label}
                {entry.shortcut && <span className="text-(--tc-value)">{entry.shortcut}</span>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
