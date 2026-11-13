import { CaretDown } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { setSelectionRate } from '../recording/edit-actions'
import { RATES, type Rate } from '../recording/timemap'
import { cn } from '../ui/controls'
import { HeaderButton } from './HeaderButton'
import { menuKeyAction } from './menu-keys'

interface SpeedMenuProps { range: boolean; rate: Rate | 'mixed' | null }

const buttonLabel = (range: boolean, rate: Rate | 'mixed' | null) => (!range || rate === null ? 'Speed' : `Speed · ${rate === 'mixed' ? 'Mixed' : `${rate}×`}`)

export function SpeedMenu({ range, rate }: SpeedMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const close = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  useEffect(() => {
    if (!range) setOpen(false)
  }, [range])

  useEffect(() => {
    if (!open) return
    const checked = RATES.findIndex((option) => option === rate)
    itemRefs.current[Math.max(checked, 0)]?.focus()
    const closeOutside = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  const pick = (option: Rate) => {
    close(true)
    setSelectionRate(option)
  }

  /** The open menu keeps every key from the window: Space would play behind it, S split and Delete cut. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const focused = itemRefs.current.findIndex((item) => item === document.activeElement)
    const action = menuKeyAction(event.key, focused, RATES.length)
    if (!action) return
    event.preventDefault()
    if (action.kind === 'focus') itemRefs.current[action.index]?.focus()
    else if (action.kind === 'pick') pick(RATES[action.index])
    else close(true)
  }

  return (
    <span ref={wrapperRef} className="relative">
      <HeaderButton
        ref={buttonRef}
        disabled={!range}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="timeline-speed"
        onClick={() => setOpen((was) => !was)}
      >
        {buttonLabel(range, rate)}
        <CaretDown size={10} />
      </HeaderButton>
      {open && (
        <div
          role="menu"
          aria-label="Speed"
          onKeyDown={onKeyDown}
          className="absolute top-full right-0 z-20 mt-1 flex min-w-16 flex-col rounded-lg border border-(--tc-line) bg-(--tc-panel) p-1 shadow-[var(--tc-panel-shadow)] backdrop-blur-[40px]"
        >
          {RATES.map((option, index) => (
            <button
              key={option}
              ref={(item) => {
                itemRefs.current[index] = item
              }}
              type="button"
              role="menuitemradio"
              aria-checked={option === rate}
              className={cn(
                'rounded-md px-2 py-1 text-left text-xs tabular-nums outline-none hover:bg-(--tc-control) focus-visible:bg-(--tc-control)',
                option === rate ? 'font-semibold text-(--tc-fg)' : 'text-(--tc-label)'
              )}
              onClick={() => pick(option)}
            >
              {option}×
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
