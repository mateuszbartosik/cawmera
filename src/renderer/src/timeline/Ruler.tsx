import type { Trim } from '../recording/trim'
import { usePlayheadDrag } from './playhead-drag'
import { formatRulerLabel, tickStep, timeToX, type TimelineView } from './scale'

interface RulerProps { view: TimelineView; width: number; trim: Trim; duration: number }

export function Ruler({ view, width, trim, duration }: RulerProps) {
  const drag = usePlayheadDrag(view, trim, duration, (ruler) => ruler)
  const step = tickStep(view, width)
  const firstTick = Math.ceil(view.start / step) * step
  const ticks = Array.from({ length: Math.max(0, Math.floor((view.end - firstTick) / step) + 1) }, (_, i) => firstTick + i * step)

  return (
    <div
      data-testid="timeline-ruler"
      className="relative cursor-pointer touch-none overflow-hidden border-b border-(--tc-divider)"
      onPointerDown={(event) => {
        if (event.button === 0) drag.begin(event)
      }}
      onPointerMove={drag.move}
      onLostPointerCapture={drag.end}
    >
      {ticks.map((tick) => (
        <span key={tick} className="pointer-events-none absolute bottom-0 h-1.5 border-l border-(--tc-line)" style={{ left: timeToX(tick, view, width) }}>
          <span className="absolute bottom-1.5 left-1 text-[10px] leading-3 text-(--tc-value) tabular-nums">{formatRulerLabel(tick)}</span>
        </span>
      ))}
    </div>
  )
}
