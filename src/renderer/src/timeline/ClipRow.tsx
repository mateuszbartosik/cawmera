import { useRef } from 'react'
import { useApp } from '../app/store'
import { rangeAt, selectRange } from '../recording/edit-actions'
import { pieceAt } from '../recording/pieces'
import type { Piece, Span } from '../recording/timemap'
import type { Click } from '../recording/track'
import type { Trim } from '../recording/trim'
import { cn } from '../ui/controls'
import { CLIP_INSET } from './layout'
import { timeToX, xToTime, type TimelineView } from './scale'

interface ClipRowProps { clicks: Click[]; pieces: Piece[]; trim: Trim; view: TimelineView; width: number }

const DRAG_THRESHOLD_PX = 3
const CUT_HATCH = 'repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--tc-fg) 14%, transparent) 4px 5px)'

function PieceBlock({ piece, view, width }: { piece: Piece; view: TimelineView; width: number }) {
  const left = timeToX(piece.start, view, width)
  const right = timeToX(piece.end, view, width)
  const label = piece.cut ? 'Cut' : piece.rate > 1 ? `${piece.rate}×` : null
  const visibleLeft = Math.max(left, 0)
  const visibleRight = Math.min(right, width)
  return (
    <div
      data-testid={piece.cut ? 'clip-cut' : 'clip-piece'}
      className={cn('absolute inset-y-0 border-l border-(--tc-line)', piece.cut ? 'bg-(--tc-canvas)/50' : piece.rate > 1 && 'bg-(--tc-accent)/10')}
      style={{ left, width: right - left, backgroundImage: piece.cut ? CUT_HATCH : undefined }}
    >
      {label && visibleRight > visibleLeft && (
        <span
          className="absolute inset-y-0 grid place-items-center text-[11px] font-semibold text-(--tc-label) tabular-nums"
          style={{ left: visibleLeft - left, width: visibleRight - visibleLeft }}
        >
          {label}
        </span>
      )}
    </div>
  )
}

export function ClipRow({ clicks, pieces, trim, view, width }: ClipRowProps) {
  const selection = useApp((s) => s.timelineSelection)
  const press = useRef<{ x: number; dragged: boolean; range: Span | null } | null>(null)
  const startX = Math.min(Math.max(timeToX(trim.start, view, width), 0), width)
  const endX = Math.min(Math.max(timeToX(trim.end, view, width), 0), width)
  const timeAt = (event: { clientX: number; currentTarget: HTMLElement }) =>
    xToTime(event.clientX - event.currentTarget.getBoundingClientRect().left, view, width)
  const clampedToTrim = (t: number) => Math.min(Math.max(t, trim.start), trim.end)
  const pressedAt = (event: { clientX: number; currentTarget: HTMLElement }) => event.clientX - event.currentTarget.getBoundingClientRect().left

  const selectedLeft = selection?.kind === 'range' ? timeToX(selection.start, view, width) : 0
  const selectedRight = selection?.kind === 'range' ? timeToX(selection.end, view, width) : 0

  return (
    <div
      data-testid="clip-row"
      className="relative touch-none overflow-hidden rounded-md border border-(--tc-line) bg-(--tc-control)"
      style={{ marginBlock: CLIP_INSET }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        press.current = { x: pressedAt(event), dragged: false, range: null }
      }}
      onPointerMove={(event) => {
        const started = press.current
        if (!started) return
        if (event.buttons === 0) {
          press.current = null
          return
        }
        const x = pressedAt(event)
        if (!started.dragged && Math.abs(x - started.x) < DRAG_THRESHOLD_PX) return
        started.dragged = true
        const from = clampedToTrim(xToTime(started.x, view, width))
        const to = clampedToTrim(timeAt(event))
        const range = { start: Math.min(from, to), end: Math.max(from, to) }
        if (range.start === range.end || (started.range?.start === range.start && started.range.end === range.end)) return
        started.range = range
        selectRange(range)
      }}
      onPointerUp={(event) => {
        const started = press.current
        press.current = null
        if (!started || started.dragged) return
        const at = timeAt(event)
        if (at < trim.start || at >= trim.end) selectRange(null)
        else selectRange(rangeAt(pieces, trim, at))
      }}
      onLostPointerCapture={() => (press.current = null)}
    >
      {pieces.map((piece) => (
        <PieceBlock key={piece.start} piece={piece} view={view} width={width} />
      ))}
      {clicks.map((click) => (
        <span
          key={click.t}
          className={cn(
            'absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-(--tc-accent) bg-(--tc-chip)',
            (pieceAt(pieces, click.t).cut || click.t < trim.start || click.t > trim.end) && 'opacity-30'
          )}
          style={{ left: timeToX(click.t, view, width) }}
        />
      ))}
      <span className="absolute inset-y-0 left-0 bg-(--tc-canvas)/70" style={{ width: startX }} />
      <span className="absolute inset-y-0 right-0 bg-(--tc-canvas)/70" style={{ width: width - endX }} />
      {selection?.kind === 'range' && (
        <span
          data-testid="clip-selection"
          className="pointer-events-none absolute inset-y-0 rounded-sm border-2 border-(--tc-accent)"
          style={{ left: selectedLeft, width: selectedRight - selectedLeft }}
        />
      )}
    </div>
  )
}
