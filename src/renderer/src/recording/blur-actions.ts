import { newId, store, updateDoc } from '../app/store'
import type { Rect } from '../render/geometry'
import { centeredBox } from '../render/layout'
import { movedBoxTime, newBoxTime, stretchedBoxTime } from './blur-boxes'
import { recordingEditLayout } from './edit-layout'
import { currentPlayhead, pausePlayback, scrubTo } from './playback'
import { getRecording } from './registry'
import { takeViewFor } from './take-view'
import type { Span } from './timemap'

function activeTake() {
  const { doc } = store.get()
  const entry = getRecording(doc.sourceId)
  if (!entry || !doc.recording) return null
  return { doc, entry, recording: doc.recording }
}

/** Playback shows the real camera and never a selected box, so selecting one pauses it and brings the playhead to the box. */
export function selectRedaction(id: string) {
  const { selection, doc } = store.get()
  const time = doc.redactions.find((redaction) => redaction.id === id)?.time
  if (time === undefined) return
  pausePlayback()
  const alreadySelected = selection.length === 1 && selection[0].kind === 'redaction' && selection[0].id === id
  if (!alreadySelected) store.set({ selection: [{ kind: 'redaction', id }] })
  const playhead = currentPlayhead()
  if (time && (playhead < time.start || playhead > time.end)) scrubTo(time.start)
}

function addTimedBox(box: Rect, history: boolean): string | null {
  const take = activeTake()
  if (!take) return null
  const { entry, recording } = take
  const id = newId()
  const time = newBoxTime(currentPlayhead(), recording.trim, entry.track.fps, entry.track.durationMs)
  updateDoc((current) => ({ redactions: [...current.redactions, { id, rect: box, time }] }), { history })
  selectRedaction(id)
  return id
}

/** A box over the middle of the frame, from the playhead to the end of the trim. */
export function addTimedRedaction() {
  const take = activeTake()
  if (!take) return
  const { doc, entry, recording } = take
  const videoSize = { width: entry.track.width, height: entry.track.height }
  const view = takeViewFor(entry, recording, doc.crop)
  const layout = recordingEditLayout(view, videoSize, doc.size, store.get().style)
  const offset = doc.redactions.length * 12
  const box = centeredBox(layout, 0.28, 0.07)
  addTimedBox({ ...box, x: box.x + offset, y: box.y + offset }, true)
}

/** A box drawn by hand joins the drag that draws it, so the drag stays one undo step. */
export function addDrawnRedaction(box: Rect): string | null {
  return addTimedBox(box, false)
}

function editRedactionTime(id: string, timeAfter: (time: Span, take: NonNullable<ReturnType<typeof activeTake>>) => Span, history: boolean) {
  const take = activeTake()
  const time = take?.doc.redactions.find((redaction) => redaction.id === id)?.time
  if (!take || !time) return
  const moved = timeAfter(time, take)
  if (moved.start === time.start && moved.end === time.end) return
  updateDoc((doc) => ({ redactions: doc.redactions.map((redaction) => (redaction.id === id ? { ...redaction, time: moved } : redaction)) }), { history })
}

export function moveRedactionTo(id: string, start: number, history = true) {
  editRedactionTime(id, (time, { entry, recording }) => movedBoxTime(time, start, recording.trim, entry.track.fps, entry.track.durationMs), history)
}

export function stretchRedactionTo(id: string, edge: 'start' | 'end', at: number, history = true) {
  editRedactionTime(id, (time, { entry, recording }) => stretchedBoxTime(time, edge, at, recording.trim, entry.track.fps, entry.track.durationMs), history)
}
