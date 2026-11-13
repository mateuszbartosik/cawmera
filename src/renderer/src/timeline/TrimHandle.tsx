import { useEffect, useRef, type KeyboardEvent } from 'react'
import { store } from '../app/store'
import { trimEdgeTo } from '../recording/edit-actions'
import type { Trim } from '../recording/trim'
import { timelinePress, useDragSession, type TimelinePress } from './drag-session'
import { CLIP_HEIGHT, CLIP_INSET, RULER_HEIGHT } from './layout'
import { formatClock, timeToX, xToTime, type TimelineView } from './scale'

const HANDLE_WIDTH = 8
const KEY_STEP_MS = 100
const KEY_STEP_SHIFT_MS = 1000

type Edge = 'start' | 'end'

interface TrimHandleProps { edge: Edge; trim: Trim; duration: number; view: TimelineView; width: number }

export function TrimHandle({ edge, trim, duration, view, width }: TrimHandleProps) {
  const drag = useDragSession()
  const keySteps = useDragSession()
  const grabOffset = useRef(0)
  const press = useRef<TimelinePress | null>(null)
  const x = timeToX(trim[edge], view, width)
  const visible = x >= 0 && x <= width

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (direction === 0) return
    event.preventDefault()
    keySteps.edit(() => {
      const current = store.get().doc.recording?.trim ?? trim
      trimEdgeTo(edge, current[edge] + direction * (event.shiftKey ? KEY_STEP_SHIFT_MS : KEY_STEP_MS), duration)
    })
  }

  useEffect(() => {
    if (visible) return
    drag.end()
    keySteps.end()
  }, [drag, keySteps, visible])

  if (!visible) return null

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={edge === 'start' ? 'Trim start' : 'Trim end'}
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={Math.round(trim[edge])}
      aria-valuetext={formatClock(trim[edge])}
      className="pointer-events-auto absolute z-10 cursor-ew-resize rounded-sm bg-(--tc-fg) outline-none focus-visible:ring-2 focus-visible:ring-(--tc-accent)/50"
      style={{
        left: x,
        top: RULER_HEIGHT + CLIP_INSET + 2,
        height: CLIP_HEIGHT - CLIP_INSET * 2 - 4,
        width: HANDLE_WIDTH,
        translate: edge === 'end' ? '-100%' : undefined
      }}
      onKeyDown={onKeyDown}
      onKeyUp={() => keySteps.end()}
      onBlur={() => keySteps.end()}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        const bounds = event.currentTarget.parentElement!.getBoundingClientRect()
        grabOffset.current = event.clientX - bounds.left - x
        press.current = timelinePress(event.clientX)
        drag.begin()
      }}
      onPointerMove={(event) => {
        if (!drag.accepts(event.buttons) || !press.current?.dragsAt(event.clientX)) return
        const bounds = event.currentTarget.parentElement!.getBoundingClientRect()
        trimEdgeTo(edge, xToTime(event.clientX - bounds.left - grabOffset.current, view, bounds.width), duration)
      }}
      onPointerUp={() => drag.end()}
      onPointerCancel={() => drag.end()}
      onLostPointerCapture={() => drag.end()}
    />
  )
}
