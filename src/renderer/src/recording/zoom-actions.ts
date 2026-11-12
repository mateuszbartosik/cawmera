import { toast } from 'sonner'
import { newId, store, updateDoc } from '../app/store'
import type { Point } from '../render/geometry'
import { setRecording } from './actions'
import { cursorPositionAt } from './cursor'
import { getRecording } from './registry'
import { takeViewFor } from './take-view'
import { snapToOutput, type Span } from './timemap'
import { addZoom, materialize, moveZoom, removeZoom, stretchZoom, type ZoomAim, type ZoomEdit } from './zoom-edits'

const NO_ROOM_MESSAGE = 'No room for a zoom here'

function activeTake() {
  const { doc } = store.get()
  const entry = getRecording(doc.sourceId)
  if (!entry || !doc.recording) return null
  const { recording } = doc
  return { entry, recording, view: takeViewFor(entry, recording, doc.crop) }
}

export function currentZoomEdits(): ZoomEdit[] {
  return activeTake()?.view.edits ?? []
}

export function selectedZoomOf(edits: ZoomEdit[]): ZoomEdit | null {
  const { timelineSelection } = store.get()
  if (timelineSelection?.kind !== 'zoom') return null
  const { id } = timelineSelection
  return edits.find((edit) => edit.id === id) ?? null
}

export function selectZoom(id: string | null) {
  store.set({ timelineSelection: id === null ? null : { kind: 'zoom', id } })
}

export function editZooms(change: (edits: ZoomEdit[], selectedId: string | null) => ZoomEdit[] | null, history = true) {
  const take = activeTake()
  if (!take) return
  const { edits } = take.view
  const selectedId = selectedZoomOf(edits)?.id ?? null
  const changed = change(edits, selectedId)
  if (!changed || changed === edits) return
  const { edits: stored, ids } = materialize(changed, newId)
  updateDoc((doc) => (doc.recording ? { recording: { ...doc.recording, zooms: stored } } : {}), { history })
  const followed = selectedId === null ? null : (ids.get(selectedId) ?? selectedId)
  if (followed !== null && stored.some((edit) => edit.id === followed)) selectZoom(followed)
}

const keptSpan = (): Span | null => {
  const take = activeTake()
  return take && { start: take.recording.trim.start, end: take.recording.trim.end }
}

export function moveSelectedZoom(start: number, history = true) {
  const bounds = keptSpan()
  if (bounds) editZooms((edits, id) => (id === null ? null : moveZoom(edits, id, start, bounds)), history)
}

export function stretchSelectedZoom(edge: 'start' | 'end', at: number, history = true) {
  const bounds = keptSpan()
  if (bounds) editZooms((edits, id) => (id === null ? null : stretchZoom(edits, id, edge, at, bounds)), history)
}

export function setSelectedZoom(patch: { depth?: number; aim?: ZoomAim }, history = true) {
  editZooms((edits, id) => (id === null ? null : edits.map((edit) => (edit.id === id ? { ...edit, ...patch } : edit))), history)
}

function focusAt(sourceMs: number): Point {
  const take = activeTake()
  if (!take) return { x: 0, y: 0 }
  const { view, entry } = take
  const { crop } = view
  if (entry.track.cursor.length === 0) return { x: crop.x + crop.w / 2, y: crop.y + crop.h / 2 }
  const cursor = cursorPositionAt(view.cursor, snapToOutput(view.map, sourceMs))
  return { x: cursor.x + crop.x, y: cursor.y + crop.y }
}

export function addZoomAt(sourceMs: number) {
  const bounds = keptSpan()
  if (!bounds) return
  const id = newId()
  const focus = focusAt(sourceMs)
  let added = false
  editZooms((edits) => {
    const next = addZoom(edits, sourceMs, focus, bounds, id)
    added = next !== null
    return next
  })
  if (added) selectZoom(id)
  else toast(NO_ROOM_MESSAGE)
}

export function deleteSelectedZoom() {
  editZooms((edits, id) => (id === null ? null : removeZoom(edits, id)))
}

export function resetZooms() {
  setRecording({ zooms: null })
}

export function zoomHint(aim: ZoomAim, clickCount: number): string {
  if (clickCount === 0) return 'No clicks in this zoom. Drag its area on the shot to aim it.'
  if (aim === 'manual') return 'Drag the area on the shot to aim it.'
  return clickCount === 1 ? 'Auto keeps this zoom’s click in view.' : `Auto keeps this zoom’s ${clickCount} clicks in view.`
}
