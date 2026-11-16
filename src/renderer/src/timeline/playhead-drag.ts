import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { store } from '../app/store'
import { scrubTo } from '../recording/playback'
import type { Trim } from '../recording/trim'
import { playheadDrag, timeToX, type TimelineView } from './scale'

/** The view on screen is worked out again from the stored one, so its edges can round by a hair. */
const LINE_SLACK_PX = 0.5

/** Where the playhead's line is drawn, or null when it's out of view. While its own drag holds it, it stays, at the nearest edge. */
export function playheadLineX(x: number, width: number, held: boolean): number | null {
  if (!held && (x < -LINE_SLACK_PX || x > width + LINE_SLACK_PX)) return null
  return Math.min(Math.max(x, 0), width)
}

/**
 * One drag of the playhead. A ruler press seeks to the pointer, while a press on the playhead's handle keeps where on the handle it
 * landed, so the playhead doesn't jump. Each move goes through playheadDrag from where the last one ended.
 */
export function playheadDragger() {
  let offset = 0
  let lastX = 0
  return {
    /** `lineX` is where the playhead's line was when its handle was pressed; a ruler press has none. */
    press(pointerX: number, lineX?: number) {
      offset = lineX === undefined ? 0 : pointerX - lineX
      lastX = pointerX - offset
    },
    move(pointerX: number, view: TimelineView, width: number, trim: Trim, durationMs: number) {
      const x = pointerX - offset
      const next = playheadDrag(x, lastX, view, width, trim, durationMs)
      lastX = x
      return next
    }
  }
}

/** Drags the playhead from the ruler or from the playhead itself. `trackOf` gives the element the timeline runs along. */
export function usePlayheadDrag(view: TimelineView, trim: Trim, durationMs: number, trackOf: (element: HTMLElement) => Element) {
  const [dragger] = useState(playheadDragger)
  const [held, setHeld] = useState(false)

  const follow = (event: ReactPointerEvent<HTMLElement>) => {
    const track = trackOf(event.currentTarget).getBoundingClientRect()
    const next = dragger.move(event.clientX - track.left, view, track.width, trim, durationMs)
    if (next.view.start !== view.start || next.view.end !== view.end) store.set({ timelineView: next.view })
    scrubTo(next.time)
  }

  return {
    held,
    /** A ruler press seeks at once; a press on the playhead's handle passes the time its line shows, and moves nothing yet. */
    begin(event: ReactPointerEvent<HTMLElement>, lineTime?: number) {
      event.currentTarget.setPointerCapture(event.pointerId)
      setHeld(true)
      const track = trackOf(event.currentTarget).getBoundingClientRect()
      const pointerX = event.clientX - track.left
      if (lineTime !== undefined) return dragger.press(pointerX, timeToX(lineTime, view, track.width))
      dragger.press(pointerX)
      follow(event)
    },
    move(event: ReactPointerEvent<HTMLElement>) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) follow(event)
    },
    end() {
      setHeld(false)
    }
  }
}
