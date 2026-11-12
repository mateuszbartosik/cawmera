import { useMemo } from 'react'
import type { Doc, Redaction } from '../app/doc'
import type { AppState, BoxRef } from '../app/store'
import { boxesShownAt, cameraViewMatrix, wideViewPoint } from '../recording/blur-boxes'
import { recordingEditLayout } from '../recording/edit-layout'
import { useRecording } from '../recording/registry'
import { takeViewFor } from '../recording/take-view'
import { showsWideFrame } from '../recording/zoom-actions'
import type { Matrix, Point, Rect } from '../render/geometry'
import { sourceRectToOutput, type Layout } from '../render/layout'

export interface Item {
  box: BoxRef
  /** Export px, in the shot. */
  out: Rect
  /** Source px. */
  src: Rect
}

export function itemsFor(doc: Doc, layout: Layout, redactions: Redaction[] = doc.redactions): Item[] {
  const items: Item[] = []
  for (const r of [...redactions].reverse()) {
    items.push({ box: { kind: 'redaction', id: r.id }, out: sourceRectToOutput(layout, r.rect), src: r.rect })
  }
  if (doc.spotlight.on && doc.spotlight.rect) {
    items.push({ box: { kind: 'spotlight' }, out: sourceRectToOutput(layout, doc.spotlight.rect), src: doc.spotlight.rect })
  }
  return items
}

export interface BoxEditing {
  isRecording: boolean
  /** Video px to export px on a recording, else the screenshot's own layout. */
  layout: Layout | null
  /** Whether the canvas shows the whole frame in the given state. */
  isWide: (s: AppState) => boolean
  /** The items to edit: on a recording, the boxes shown at the playhead plus the selected ones. */
  itemsOf: (s: AppState) => Item[]
  /** A point in the shot (export px) as it sits in the frame the boxes are edited in. */
  toEditSpace: (p: Point, s: AppState) => Point
  /** What the camera does to the overlay while the canvas isn't wide; null when it is, or on a screenshot. */
  cameraView: Matrix | null
}

/** Box editing on the active shot: a screenshot edits as it shows, a recording edits in its wide frame. */
export function useBoxEditing(state: AppState, screenshotLayout: Layout | null): BoxEditing {
  const { doc, style } = state
  const entry = useRecording(doc.sourceId)
  const take = useMemo(
    () => (entry && doc.recording ? { view: takeViewFor(entry, doc.recording, doc.crop), video: { width: entry.track.width, height: entry.track.height } } : null),
    [entry, doc.recording, doc.crop]
  )
  const layout = take ? recordingEditLayout(take.view, take.video, doc.size, style) : screenshotLayout
  const isWide = (s: AppState) => take !== null && showsWideFrame(s.selection, take.view.edits, s.timelineSelection)
  return {
    isRecording: take !== null,
    layout,
    isWide,
    itemsOf: (s) => {
      if (!layout) return []
      if (!take) return itemsFor(s.doc, layout)
      const selected = new Set(s.selection.flatMap((box) => (box.kind === 'redaction' ? [box.id] : [])))
      return itemsFor(s.doc, layout, boxesShownAt(s.doc.redactions, s.playback.time, selected))
    },
    toEditSpace: (p, s) => (take ? wideViewPoint(p, isWide(s), take.view, doc.size, style, s.playback.time) : p),
    cameraView: take && !isWide(state) ? cameraViewMatrix(take.view, doc.size, style, state.playback.time) : null
  }
}
