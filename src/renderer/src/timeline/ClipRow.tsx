import type { Click } from '../recording/track'
import type { Trim } from '../recording/trim'
import { CLIP_INSET } from './layout'
import { timeToX, type TimelineView } from './scale'

interface ClipRowProps { clicks: Click[]; trim: Trim; view: TimelineView; width: number }

export function ClipRow({ clicks, trim, view, width }: ClipRowProps) {
  const startX = Math.min(Math.max(timeToX(trim.start, view, width), 0), width)
  const endX = Math.min(Math.max(timeToX(trim.end, view, width), 0), width)
  return (
    <div className="relative overflow-hidden rounded-md border border-(--tc-line) bg-(--tc-control)" style={{ marginBlock: CLIP_INSET }}>
      {clicks.map((click) => (
        <span
          key={click.t}
          className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-(--tc-accent) bg-(--tc-chip)"
          style={{ left: timeToX(click.t, view, width) }}
        />
      ))}
      <span className="absolute inset-y-0 left-0 bg-(--tc-canvas)/70" style={{ width: startX }} />
      <span className="absolute inset-y-0 right-0 bg-(--tc-canvas)/70" style={{ width: width - endX }} />
    </div>
  )
}
