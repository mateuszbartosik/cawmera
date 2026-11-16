import type { PointerEvent as ReactPointerEvent } from 'react'
import { scrubTo } from '../recording/playback'
import type { Trim } from '../recording/trim'
import { clamp } from '../render/geometry'
import { RULER_HEIGHT } from './layout'
import { timeToX, xToTime, type TimelineView } from './scale'

/** The grab area reaches this far either side of the line, and down the ruler only: below it, the rows take every press. */
const GRAB_SIDE = 6
const GRAB_ABOVE = 4

interface PlayheadProps { time: number; trim: Trim; view: TimelineView; width: number }

export function Playhead({ time, trim, view, width }: PlayheadProps) {
  const x = timeToX(clamp(time, trim.start, trim.end), view, width)
  if (x < 0 || x > width) return null

  const scrubToPointer = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const bounds = event.currentTarget.parentElement!.parentElement!.getBoundingClientRect()
    scrubTo(clamp(xToTime(event.clientX - bounds.left, view, bounds.width), trim.start, trim.end))
  }

  return (
    <div className="pointer-events-none absolute inset-y-0 w-px bg-(--tc-accent)" style={{ left: x }} data-testid="timeline-playhead">
      <span aria-hidden className="absolute -top-0.5 -left-1 size-2.5 rounded-full bg-(--tc-accent)" />
      <span
        className="pointer-events-auto absolute cursor-ew-resize touch-none"
        style={{ left: -GRAB_SIDE, top: -GRAB_ABOVE, width: GRAB_SIDE * 2 + 1, height: RULER_HEIGHT + GRAB_ABOVE }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          scrubToPointer(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) scrubToPointer(event)
        }}
      />
    </div>
  )
}
