import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { ArrowCounterClockwise, CaretDown, Question } from '@phosphor-icons/react'

export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

// ---------------------------------------------------------------------------
// Tooltip: portalled so the scrolling panel never clips it.

export function Tooltip({
  text,
  side = 'top',
  children
}: {
  text: ReactNode
  side?: 'top' | 'bottom' | 'left'
  children: (props: { ref: (el: HTMLElement | null) => void; 'aria-describedby'?: string }) => ReactElement
}) {
  const id = useId()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!anchor) return
    let timer = 0
    const show = () => {
      timer = window.setTimeout(() => setOpen(true), 350)
    }
    const hide = () => {
      window.clearTimeout(timer)
      setOpen(false)
    }
    anchor.addEventListener('pointerenter', show)
    anchor.addEventListener('pointerleave', hide)
    anchor.addEventListener('pointerdown', hide)
    anchor.addEventListener('focus', show)
    anchor.addEventListener('blur', hide)
    return () => {
      window.clearTimeout(timer)
      anchor.removeEventListener('pointerenter', show)
      anchor.removeEventListener('pointerleave', hide)
      anchor.removeEventListener('pointerdown', hide)
      anchor.removeEventListener('focus', show)
      anchor.removeEventListener('blur', hide)
    }
  }, [anchor])

  useLayoutEffect(() => {
    if (!open || !anchor || !tipRef.current) return
    const a = anchor.getBoundingClientRect()
    const t = tipRef.current.getBoundingClientRect()
    const gap = 6
    let left = side === 'left' ? a.left - t.width - gap : a.left + a.width / 2 - t.width / 2
    let top = side === 'top' ? a.top - t.height - gap : side === 'bottom' ? a.bottom + gap : a.top + a.height / 2 - t.height / 2
    left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8))
    top = Math.max(8, Math.min(top, window.innerHeight - t.height - 8))
    setPosition({ left, top })
  }, [open, anchor, side])

  return (
    <>
      {children({ ref: setAnchor, 'aria-describedby': open ? id : undefined })}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className="pointer-events-none fixed z-50 max-w-[240px] rounded-md bg-(--tc-tooltip) px-2 py-1.5 text-xs leading-[1.45] text-(--tc-tooltip-fg) shadow-lg"
            style={{ left: position?.left ?? -9999, top: position?.top ?? -9999 }}
          >
            {text}
          </div>,
          document.body
        )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Buttons

export function IconButton({
  label,
  shortcut,
  active,
  className,
  children,
  side = 'top',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; shortcut?: string; active?: boolean; side?: 'top' | 'bottom' | 'left' }) {
  return (
    <Tooltip
      side={side}
      text={
        <span className="flex items-center gap-2">
          {label}
          {shortcut && <kbd className="font-sans text-(--tc-tooltip-fg)/60">{shortcut}</kbd>}
        </span>
      }
    >
      {(tip) => (
        <button
          type="button"
          aria-label={label}
          {...tip}
          {...rest}
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-md text-(--tc-label) transition-colors hover:bg-(--tc-control) hover:text-(--tc-fg) disabled:pointer-events-none disabled:opacity-35',
            active && 'bg-(--tc-control) text-(--tc-fg)',
            className
          )}
        >
          {children}
        </button>
      )}
    </Tooltip>
  )
}

export function Button({
  icon,
  variant = 'secondary',
  pressed,
  className,
  children,
  hint,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode
  variant?: 'secondary' | 'primary'
  pressed?: boolean
  hint?: string
}) {
  const button = (tip?: Record<string, unknown>) => (
    <button
      type="button"
      aria-pressed={pressed}
      {...tip}
      {...rest}
      className={cn(
        'inline-flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-lg border pr-2 pl-1.5 text-[13px] leading-[18px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-(--tc-accent)/50 disabled:pointer-events-none disabled:opacity-40',
        variant === 'primary'
          ? 'border-transparent bg-(--tc-primary) text-(--tc-primary-fg) hover:opacity-90'
          : pressed
            ? 'border-(--tc-accent) bg-(--tc-accent)/15 text-(--tc-fg)'
            : 'border-(--tc-line) bg-(--tc-control) text-(--tc-fg) hover:bg-(--tc-control-hover)',
        className
      )}
    >
      {icon && <span className="grid size-4 shrink-0 place-items-center">{icon}</span>}
      <span className="truncate">{children}</span>
    </button>
  )
  if (!hint) return button()
  return <Tooltip text={hint}>{(tip) => button(tip)}</Tooltip>
}

/** Actions row: one button takes the left half, two fill the row. */
export function ActionsRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>
}

// ---------------------------------------------------------------------------
// Section

export function Section({
  title,
  collapsed,
  onToggle,
  onReset,
  resetLabel,
  actions,
  empty = false,
  children,
  testId
}: {
  title: string
  collapsed: boolean
  onToggle: () => void
  onReset?: () => void
  resetLabel?: string
  /** Extra header buttons (e.g. + to add an item), shown before reset. */
  actions?: ReactNode
  /** Header only: nothing to show or collapse yet. */
  empty?: boolean
  children?: ReactNode
  testId?: string
}) {
  const bodyId = useId()
  const open = !collapsed && !empty
  return (
    <section data-testid={testId} className="border-t border-(--tc-divider) first:border-t-0">
      <div className="flex h-9 items-center gap-0.5 pr-1.5 pl-3">
        <button
          type="button"
          className="h-full flex-1 text-left text-[11px] leading-[11px] font-semibold tracking-normal text-(--tc-title) uppercase outline-none focus-visible:text-(--tc-fg)"
          aria-expanded={empty ? undefined : !collapsed}
          aria-controls={empty ? undefined : bodyId}
          onClick={empty ? undefined : onToggle}
          tabIndex={empty ? -1 : undefined}
        >
          {title}
        </button>
        {actions}
        {onReset && (
          <IconButton label={resetLabel ?? `Reset ${title.toLowerCase()}`} onClick={onReset}>
            <ArrowCounterClockwise size={13} />
          </IconButton>
        )}
        {!empty && (
          <IconButton label={collapsed ? 'Expand' : 'Collapse'} active={!collapsed} onClick={onToggle}>
            <CaretDown size={12} weight="bold" className={cn('transition-transform duration-200', !collapsed && 'rotate-180')} />
          </IconButton>
        )}
      </div>
      {!empty && (
        <div
          id={bodyId}
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
            open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          )}
          inert={!open}
        >
          <div className="overflow-hidden">
            <div className="flex flex-col gap-4 px-3 pt-2 pb-6">{children}</div>
          </div>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Fields

export function HelpTip({ text }: { text: string }) {
  return (
    <Tooltip text={text}>
      {(tip) => (
        <span {...tip} tabIndex={0} aria-label={text} className="inline-grid cursor-help text-(--tc-label) outline-none">
          <Question size={12} weight="fill" />
        </span>
      )}
    </Tooltip>
  )
}

export function Field({
  label,
  help,
  value,
  htmlFor,
  children
}: {
  label: string
  help?: string
  value?: ReactNode
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-[17px] items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs leading-[16.5px] font-medium text-(--tc-label)">
          {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
          {help && <HelpTip text={help} />}
        </span>
        {value !== undefined && <div className="text-xs leading-5 text-(--tc-value) tabular-nums">{value}</div>}
      </div>
      {children}
    </div>
  )
}

export function Slider({
  label,
  help,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
  onCommit
}: {
  label: string
  help?: string
  value: number
  min: number
  max: number
  step?: number
  format: (value: number) => string
  onChange: (value: number) => void
  onCommit?: () => void
}) {
  const id = useId()
  const fill = ((value - min) / (max - min)) * 100
  return (
    <Field label={label} help={help} value={format(value)} htmlFor={id}>
      <input
        id={id}
        type="range"
        className="tc-range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--fill' as string]: `${fill}%` }}
        aria-valuetext={format(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </Field>
  )
}

export interface SegmentOption<T> {
  value: T
  label: string
}

export function Segmented<T extends string | number>({
  label,
  help,
  value,
  options,
  onChange,
  testId
}: {
  label: string
  help?: string
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  testId?: string
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const index = Math.max(0, options.findIndex((option) => option.value === value))
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (!delta) return
    event.preventDefault()
    const next = (index + delta + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }
  return (
    <Field label={label} help={help}>
      <div
        role="radiogroup"
        aria-label={label}
        data-testid={testId}
        className="grid h-7 gap-0.5 rounded-lg bg-(--tc-control) p-0.5"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        onKeyDown={onKeyDown}
      >
        {options.map((option, i) => {
          const selected = i === index
          return (
            <button
              key={String(option.value)}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(option.value)}
              className={cn(
                'rounded-md text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-(--tc-accent)/50',
                selected ? 'bg-(--tc-chip) text-(--tc-fg) shadow-[0_1px_2px_rgb(0_0_0/0.18)]' : 'text-(--tc-label) hover:text-(--tc-fg)'
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </Field>
  )
}

export function Switch({
  label,
  checked,
  onChange,
  testId
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  testId?: string
}) {
  const id = useId()
  return (
    <div className="flex h-5 items-center gap-2">
      <button
        id={id}
        type="button"
        role="switch"
        data-testid={testId}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative h-4 w-7 shrink-0 rounded-full p-px transition-colors outline-none focus-visible:ring-2 focus-visible:ring-(--tc-accent)/50"
        style={{ background: checked ? 'var(--tc-accent)' : 'var(--tc-track)' }}
      >
        <span
          className="block size-3.5 rounded-full bg-white shadow-sm transition-transform duration-150"
          style={{ transform: checked ? 'translateX(12px)' : 'translateX(0)' }}
        />
      </button>
      <label htmlFor={id} className="cursor-pointer text-[13px] leading-[18px] text-(--tc-fg)">
        {label}
      </label>
    </div>
  )
}

export function TextField({
  label,
  help,
  value,
  placeholder,
  suffix,
  onChange,
  onCommit,
  testId
}: {
  label: string
  help?: string
  value: string
  placeholder?: string
  suffix?: string
  onChange: (value: string) => void
  onCommit?: () => void
  testId?: string
}) {
  const id = useId()
  return (
    <Field label={label} help={help} htmlFor={id}>
      <div className="flex h-7 items-center rounded-lg border border-(--tc-line) bg-(--tc-control) transition-colors focus-within:border-(--tc-accent)">
        <input
          id={id}
          data-testid={testId}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-[13px] text-(--tc-fg) outline-none placeholder:text-(--tc-value)"
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          }}
        />
        {suffix && <span className="pr-2 text-[13px] text-(--tc-value)">{suffix}</span>}
      </div>
    </Field>
  )
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const next = draft.startsWith('#') ? draft : `#${draft}`
    if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next.toUpperCase())
    else setDraft(value)
  }
  return (
    <Field label={label}>
      <div className="flex h-7 items-center gap-2 rounded-lg border border-(--tc-line) bg-(--tc-control) px-1.5 focus-within:border-(--tc-accent)">
        <span className="relative size-4 shrink-0 overflow-hidden rounded-[4px] ring-1 ring-(--tc-line)" style={{ background: value }}>
          <input
            type="color"
            aria-label={`${label} colour`}
            value={value}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </span>
        <input
          aria-label={`${label} hex`}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-(--tc-fg) uppercase outline-none"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
          }}
        />
      </div>
    </Field>
  )
}

/** Compact number input with a unit, e.g. an angle. Arrow keys step (Shift for 10×). */
export function NumberField({
  label,
  value,
  suffix,
  min,
  max,
  wrap = false,
  compact = false,
  onChange,
  testId
}: {
  label: string
  value: number
  suffix?: string
  min: number
  max: number
  /** Past max comes back round to min (angles). */
  wrap?: boolean
  /** Small enough to sit in a field's label row. */
  compact?: boolean
  onChange: (value: number) => void
  testId?: string
}) {
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setDraft(String(value))
  }, [value, editing])
  const fit = (next: number) => {
    if (wrap) {
      const span = max - min + 1
      return ((((Math.round(next) - min) % span) + span) % span) + min
    }
    return Math.min(max, Math.max(min, Math.round(next)))
  }
  const commit = () => {
    setEditing(false)
    const parsed = Number.parseFloat(draft)
    if (Number.isFinite(parsed)) onChange(fit(parsed))
    else setDraft(String(value))
  }
  return (
    <div
      className={cn(
        'flex items-center border border-(--tc-line) bg-(--tc-control) transition-colors focus-within:border-(--tc-accent)',
        compact ? 'h-6 w-14 rounded-md' : 'h-7 w-16 rounded-lg'
      )}
    >
      <input
        aria-label={label}
        data-testid={testId}
        inputMode="numeric"
        // As wide as the number, so the unit sits right after it ("68°").
        style={{ width: `calc(${Math.max(1, draft.length)}ch + 10px)` }}
        className={cn('h-full min-w-0 bg-transparent pl-2 text-(--tc-fg) tabular-nums outline-none', compact ? 'text-xs' : 'text-[13px]')}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => setEditing(true)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1)
            const next = fit(value + step)
            onChange(next)
            setDraft(String(next))
          }
        }}
      />
      {suffix && <span className={cn('flex-1 pr-2 text-(--tc-value)', compact ? 'text-xs' : 'text-[13px]')}>{suffix}</span>}
    </div>
  )
}
