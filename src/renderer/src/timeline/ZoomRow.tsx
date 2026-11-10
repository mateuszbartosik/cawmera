import type { TimeMap } from '../recording/timemap'
import { outputToSource } from '../recording/timemap'
import type { ZoomSegment } from '../recording/zooms'
import { timeToX, type TimelineView } from './scale'

const MIN_ZOOM_BLOCK_PX = 28

interface ZoomRowProps { zooms: ZoomSegment[]; map: TimeMap; view: TimelineView; width: number }

export function ZoomRow({ zooms, map, view, width }: ZoomRowProps) {
  return (
    <div className="relative overflow-hidden">
      {zooms.map((zoom) => {
        const left = timeToX(outputToSource(map, zoom.start), view, width)
        const right = timeToX(outputToSource(map, zoom.end), view, width)
        return (
          <span
            key={zoom.start}
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
