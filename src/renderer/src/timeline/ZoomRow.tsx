import type { ZoomEdit } from '../recording/zoom-edits'
import { timeToX, type TimelineView } from './scale'

const MIN_ZOOM_BLOCK_PX = 28

interface ZoomRowProps { edits: ZoomEdit[]; view: TimelineView; width: number }

export function ZoomRow({ edits, view, width }: ZoomRowProps) {
  return (
    <div className="relative overflow-hidden">
      {edits.map((zoom) => {
        const left = timeToX(zoom.start, view, width)
        const right = timeToX(zoom.end, view, width)
        return (
          <span
            key={zoom.id}
            className="absolute top-1/2 grid h-6 -translate-y-1/2 place-items-center rounded-md border border-(--tc-accent)/60 bg-(--tc-accent)/15 text-[11px] font-semibold text-(--tc-fg) tabular-nums"
            style={{ left, width: Math.max(MIN_ZOOM_BLOCK_PX, right - left) }}
          >
            {zoom.depth.toFixed(1)}×
          </span>
        )
      })}
    </div>
  )
}
