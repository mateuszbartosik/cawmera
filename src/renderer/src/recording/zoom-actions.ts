import { toast } from 'sonner'
import { newId, store, updateDoc, type TimelineSelection } from '../app/store'
import type { Point } from '../render/geometry'
import { setRecording } from './actions'
import { cursorPositionAt } from './cursor'
import { getRecording } from './registry'
import { takeViewFor } from './take-view'
import { snapToOutput, type Span } from './timemap'
import { addZoom, materialize, moveZoom, removeZoom, setZoom, stretchZoom, type ZoomAim, type ZoomEdit } from './zoom-edits'

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

export function selectedZoomOf(edits: ZoomEdit[], selection: TimelineSelection = store.get().timelineSelection): ZoomEdit | null {
  if (selection?.kind !== 'zoom') return null
  const { id } = selection
  return edits.find((edit) => edit.id === id) ?? null
}

export function selectZoom(id: string | null) {
  const { timelineSelection } = store.get()
  const alreadySelected = id === null ? timelineSelection === null : timelineSelection?.kind === 'zoom' && timelineSelection.id === id
  if (alreadySelected) return
  store.set({ timelineSelection: id === null ? null : { kind: 'zoom', id } })
}

/** Returns the ids the first edit gave the automatic zooms it stored; empty when nothing changed. */
export function editZooms(change: (edits: ZoomEdit[], selectedId: string | null) => ZoomEdit[] | null, history = true): Map<string, string> {
  const take = activeTake()
  if (!take) return new Map()
  const { edits } = take.view
  const selectedId = selectedZoomOf(edits)?.id ?? null
  const changed = change(edits, selectedId)
  if (!changed || changed === edits) return new Map()
  const { edits: stored, ids } = materialize(changed, newId)
  updateDoc((doc) => (doc.recording ? { recording: { ...doc.recording, zooms: stored } } : {}), { history })
  const followed = selectedId === null ? null : (ids.get(selectedId) ?? selectedId)
  if (followed !== null && stored.some((edit) => edit.id === followed)) selectZoom(followed)
  return ids
}

const keptSpan = (): Span | null => {
  const take = activeTake()
  return take && { start: take.recording.trim.start, end: take.recording.trim.end }
}

/** Edits one zoom whatever is selected, and returns the id it has afterwards. */
function editZoomById(id: string, change: (edits: ZoomEdit[]) => ZoomEdit[] | null, history: boolean): string {
  const ids = editZooms(change, history)
  return ids.get(id) ?? id
}

export function moveZoomTo(id: string, start: number, history = true): string {
  const bounds = keptSpan()
  return bounds ? editZoomById(id, (edits) => moveZoom(edits, id, start, bounds), history) : id
}

export function stretchZoomTo(id: string, edge: 'start' | 'end', at: number, history = true): string {
  const bounds = keptSpan()
  return bounds ? editZoomById(id, (edits) => stretchZoom(edits, id, edge, at, bounds), history) : id
}

export function setSelectedZoom(patch: { depth?: number; aim?: ZoomAim }, history = true) {
  editZooms((edits, id) => (id === null ? null : setZoom(edits, id, patch)), history)
}

/** Aimed by hand, a zoom is Manual. */
export function aimZoomByHand(id: string, framing: Partial<Pick<ZoomEdit, 'focus' | 'depth'>>, history = true): string {
  const aimed = (edits: ZoomEdit[]) => (edits.some((edit) => edit.id === id) ? setZoom(edits, id, { ...framing, aim: 'manual' }) : null)
  return editZoomById(id, aimed, history)
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
  let added = false
  editZooms((edits) => {
    const placed = addZoom(edits, sourceMs, { x: 0, y: 0 }, bounds, id)
    const zoom = placed?.find((edit) => edit.id === id)
    added = zoom !== undefined
    if (!placed || !zoom) return null
    const focus = focusAt(zoom.start)
    return placed.map((edit) => (edit.id === id ? { ...edit, focus } : edit))
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

export const autoAimAvailable = (clickCount: number) => clickCount > 0

export const zoomAreaLabel = ({ depth, aim }: Pick<ZoomEdit, 'depth' | 'aim'>) => `${depth.toFixed(1)}× · ${aim === 'auto' ? 'Auto' : 'Manual'}`
