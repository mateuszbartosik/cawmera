import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { store } from '../app/store'
import { scrubTo } from '../recording/playback'
import type { Trim } from '../recording/trim'
import { playheadDrag, type TimelineView } from './scale'

/**
 * Drags the playhead from the ruler or from the playhead itself. `trackOf` gives the element the timeline runs along. Past either
 * edge the view scrolls with the pointer, and only as it moves: see playheadDrag.
 */
export function usePlayheadDrag(view: TimelineView, trim: Trim, durationMs: number, trackOf: (element: HTMLElement) => Element) {
  const from = useRef<TimelineView | null>(null)

  const follow = (event: ReactPointerEvent<HTMLElement>) => {
    const track = trackOf(event.currentTarget).getBoundingClientRect()
    const next = playheadDrag(event.clientX - track.left, from.current ?? view, track.width, trim, durationMs)
    if (next.view.start !== view.start || next.view.end !== view.end) store.set({ timelineView: next.view })
    scrubTo(next.time)
  }

  return {
    begin(event: ReactPointerEvent<HTMLElement>) {
      event.currentTarget.setPointerCapture(event.pointerId)
      from.current = view
      follow(event)
    },
    move(event: ReactPointerEvent<HTMLElement>) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) follow(event)
    },
    end() {
      from.current = null
    }
  }
}
