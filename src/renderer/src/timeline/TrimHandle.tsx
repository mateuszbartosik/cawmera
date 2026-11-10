import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { Doc } from '../app/doc'
import { commitFrom, store } from '../app/store'
import { setRecording } from '../recording/actions'
import { applyTrim, scrubTo } from '../recording/playback'
import type { Trim } from '../recording/trim'
import { CLIP_HEIGHT, CLIP_INSET, RULER_HEIGHT } from './layout'
import { dragTrim, formatClock, timeToX, xToTime, type TimelineView } from './scale'

const HANDLE_WIDTH = 8
const KEY_STEP_MS = 100
const KEY_STEP_SHIFT_MS = 1000

type Edge = 'start' | 'end'

interface TrimHandleProps { edge: Edge; trim: Trim; duration: number; view: TimelineView; width: number }

export function TrimHandle({ edge, trim, duration, view, width }: TrimHandleProps) {
  const docBeforeDrag = useRef<Doc | null>(null)
  const grabOffset = useRef(0)
  const docBeforeKeys = useRef<Doc | null>(null)
  const x = timeToX(trim[edge], view, width)

  const finish = (before: { current: Doc | null }) => {
    if (before.current) commitFrom(before.current)
    before.current = null
  }
  const moveEdgeTo = (t: number) => {
    const current = store.get().doc.recording?.trim
    if (!current) return
    const next = dragTrim(current, edge, t, duration)
    setRecording({ trim: next }, false)
    applyTrim(next)
    scrubTo(next[edge])
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (direction === 0) return
    event.preventDefault()
    docBeforeKeys.current ??= store.get().doc
    const current = store.get().doc.recording?.trim ?? trim
    moveEdgeTo(current[edge] + direction * (event.shiftKey ? KEY_STEP_SHIFT_MS : KEY_STEP_MS))
  }

  useEffect(
    () => () => {
      finish(docBeforeDrag)
      finish(docBeforeKeys)
    },
    []
  )

  if (x < 0 || x > width) return null

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
      onKeyUp={() => finish(docBeforeKeys)}
      onBlur={() => finish(docBeforeKeys)}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        const bounds = event.currentTarget.parentElement!.getBoundingClientRect()
        grabOffset.current = event.clientX - bounds.left - x
        docBeforeDrag.current = store.get().doc
      }}
      onPointerMove={(event) => {
        if (!docBeforeDrag.current) return
        const bounds = event.currentTarget.parentElement!.getBoundingClientRect()
        moveEdgeTo(xToTime(event.clientX - bounds.left - grabOffset.current, view, bounds.width))
      }}
      onPointerUp={() => finish(docBeforeDrag)}
      onPointerCancel={() => finish(docBeforeDrag)}
      onLostPointerCapture={() => finish(docBeforeDrag)}
    />
  )
}
