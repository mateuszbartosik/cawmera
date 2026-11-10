import type { PointerEvent as ReactPointerEvent } from 'react'
import { scrubTo } from '../recording/playback'
import { clamp } from '../render/geometry'
import type { Trim } from '../recording/trim'
import { formatRulerLabel, tickStep, timeToX, xToTime, type TimelineView } from './scale'

interface RulerProps { view: TimelineView; width: number; trim: Trim }

export function Ruler({ view, width, trim }: RulerProps) {
  const step = tickStep(view, width)
  const firstTick = Math.ceil(view.start / step) * step
  const ticks = Array.from({ length: Math.max(0, Math.floor((view.end - firstTick) / step) + 1) }, (_, i) => firstTick + i * step)

  const scrubToPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    scrubTo(clamp(xToTime(event.clientX - bounds.left, view, bounds.width), trim.start, trim.end))
  }

  return (
    <div
      data-testid="timeline-ruler"
      className="relative cursor-pointer touch-none overflow-hidden border-b border-(--tc-divider)"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        scrubToPointer(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) scrubToPointer(event)
      }}
    >
      {ticks.map((tick) => (
        <span key={tick} className="pointer-events-none absolute bottom-0 h-1.5 border-l border-(--tc-line)" style={{ left: timeToX(tick, view, width) }}>
          <span className="absolute bottom-1.5 left-1 text-[10px] leading-3 text-(--tc-value) tabular-nums">{formatRulerLabel(tick)}</span>
        </span>
      ))}
    </div>
  )
}
