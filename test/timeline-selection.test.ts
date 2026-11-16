import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DOC, type Doc } from '../src/renderer/src/app/doc'
import { deleteAction, escapeAction } from '../src/renderer/src/app/selection-keys'
import { addShot, redo, selectShot, store, undo, updateDoc, validTimelineSelection } from '../src/renderer/src/app/store'
import { setPlaying } from '../src/renderer/src/recording/playback'
import { DEFAULT_RECORDING } from '../src/renderer/src/recording/settings'
import { wholeTake } from '../src/renderer/src/recording/timemap'
import type { ZoomEdit } from '../src/renderer/src/recording/zoom-edits'

const recordingDoc = (durationMs: number): Doc => ({
  ...DEFAULT_DOC,
  sourceId: 'take',
  recording: { ...DEFAULT_RECORDING, trim: { start: 0, end: durationMs }, pieces: wholeTake(durationMs), zooms: null }
})
const storedZoom = (id: string): ZoomEdit => ({ id, start: 1000, end: 3000, depth: 2, aim: 'manual', focus: { x: 960, y: 540 } })
const withZooms = (doc: Doc, zooms: ZoomEdit[] | null): Doc => ({ ...doc, recording: { ...doc.recording!, zooms } })

const box = { kind: 'redaction', id: 'box' } as const

beforeEach(() => {
  const doc = recordingDoc(10_000)
  const record = { id: 'take', defaultName: 'brave-otter-fig', doc, past: [], future: [], savedDoc: null, draftDoc: null }
  store.set({
    shots: [record],
    activeId: 'take',
    doc,
    past: [],
    future: [],
    selection: [],
    timelineView: null,
    timelineSelection: null,
    shotSelection: [],
    playback: { playing: false, time: 0 }
  })
})

describe('timeline selection', () => {
  it('clears the box selection when a timeline selection is set, and the other way round', () => {
    store.set({ selection: [{ kind: 'spotlight' }] })
    store.set({ timelineSelection: { kind: 'range', start: 1000, end: 2000 } })
    expect(store.get().selection).toEqual([])
    store.set({ selection: [{ kind: 'spotlight' }] })
    expect(store.get().timelineSelection).toBeNull()
  })

  it('keeps a timeline selection when the box selection is emptied', () => {
    store.set({ timelineSelection: { kind: 'range', start: 1000, end: 2000 } })
    store.set({ selection: [] })
    expect(store.get().timelineSelection).not.toBeNull()
  })

  it('clamps a range to the take and clears one outside it', () => {
    const doc = recordingDoc(10_000)
    expect(validTimelineSelection(doc, { kind: 'range', start: 8000, end: 12_000 })).toEqual({ kind: 'range', start: 8000, end: 10_000 })
    expect(validTimelineSelection(doc, { kind: 'range', start: 11_000, end: 12_000 })).toBeNull()
    const inside = { kind: 'range', start: 1000, end: 2000 } as const
    expect(validTimelineSelection(doc, inside)).toBe(inside)
  })

  it('clears a zoom that no longer exists', () => {
    expect(validTimelineSelection(recordingDoc(10_000), { kind: 'zoom', id: 'gone' })).toBeNull()
  })

  it('keeps a stored zoom selected through doc changes until it is gone', () => {
    updateDoc(withZooms(store.get().doc, [storedZoom('z1'), storedZoom('z2')]))
    store.set({ timelineSelection: { kind: 'zoom', id: 'z2' } })
    updateDoc({ recording: { ...store.get().doc.recording!, cursorSize: 2 } })
    expect(store.get().timelineSelection).toEqual({ kind: 'zoom', id: 'z2' })
    updateDoc(withZooms(store.get().doc, [storedZoom('z1')]))
    expect(store.get().timelineSelection).toBeNull()
    expect(validTimelineSelection(withZooms(recordingDoc(10_000), [storedZoom('z1')]), { kind: 'zoom', id: 'auto-0' })).toBeNull()
  })

  it('keeps an automatic zoom selected through doc changes while the zooms are automatic', () => {
    store.set({ timelineSelection: { kind: 'zoom', id: 'auto-1' } })
    updateDoc({ recording: { ...store.get().doc.recording!, cursorSize: 2 } })
    expect(store.get().timelineSelection).toEqual({ kind: 'zoom', id: 'auto-1' })
    expect(validTimelineSelection(recordingDoc(10_000), { kind: 'zoom', id: 'z1' })).toBeNull()
    expect(validTimelineSelection(DEFAULT_DOC, { kind: 'zoom', id: 'auto-1' })).toBeNull()
  })

  it('is revalidated on every doc change, undo included', () => {
    store.set({ timelineSelection: { kind: 'range', start: 6000, end: 10_000 } })
    updateDoc({ recording: recordingDoc(8000).recording })
    expect(store.get().timelineSelection).toEqual({ kind: 'range', start: 6000, end: 8000 })
    updateDoc({ recording: recordingDoc(5000).recording })
    expect(store.get().timelineSelection).toBeNull()
    store.set({ timelineSelection: { kind: 'range', start: 6000, end: 7000 } })
    undo()
    expect(store.get().timelineSelection).toEqual({ kind: 'range', start: 6000, end: 7000 })
  })

  it('resets the view and the selection when the shot changes', () => {
    store.set({ timelineView: { start: 1000, end: 4000 }, timelineSelection: { kind: 'range', start: 1000, end: 2000 } })
    const other = addShot()
    expect(store.get().timelineView).toBeNull()
    expect(store.get().timelineSelection).toBeNull()
    store.set({ timelineView: { start: 1000, end: 4000 }, timelineSelection: { kind: 'range', start: 1000, end: 2000 } })
    selectShot('take')
    expect(other).not.toBe('take')
    expect(store.get().timelineView).toBeNull()
    expect(store.get().timelineSelection).toBeNull()
  })
})

describe('starting playback', () => {
  it('drops a box selection', () => {
    store.set({ selection: [box] })
    setPlaying(true)
    expect(store.get().selection).toEqual([])
  })

  it('drops a zoom selection but keeps a range', () => {
    store.set({ timelineSelection: { kind: 'zoom', id: 'z' } })
    setPlaying(true)
    expect(store.get().timelineSelection).toBeNull()
    const range = { kind: 'range', start: 1000, end: 2000 } as const
    store.set({ timelineSelection: range })
    setPlaying(true)
    expect(store.get().timelineSelection).toBe(range)
  })
})

describe('selection details', () => {
  it('lets the timeline selection win when one patch sets both', () => {
    store.set({ selection: [{ kind: 'spotlight' }], timelineSelection: { kind: 'range', start: 1000, end: 2000 } })
    expect(store.get().selection).toEqual([])
    expect(store.get().timelineSelection).not.toBeNull()
  })

  it('revalidates on redo', () => {
    updateDoc({ recording: recordingDoc(5000).recording })
    undo()
    store.set({ timelineSelection: { kind: 'range', start: 6000, end: 9000 } })
    redo()
    expect(store.get().timelineSelection).toBeNull()
  })

  it('keeps the selections exclusive through undo', () => {
    updateDoc({ recording: recordingDoc(9000).recording })
    store.set({ selection: [{ kind: 'spotlight' }] })
    store.set({ timelineSelection: { kind: 'range', start: 1000, end: 2000 } })
    undo()
    expect(store.get().selection).toEqual([])
    expect(store.get().timelineSelection).not.toBeNull()
  })

  it('escapes the box selection, then the timeline selection, then picked shots', () => {
    const base = { selection: [], timelineSelection: null, shotSelection: [] }
    expect(escapeAction(base)).toBeNull()
    expect(escapeAction({ ...base, timelineSelection: { kind: 'zoom', id: 'z' }, shotSelection: ['a'] })).toBe('clear-timeline')
    expect(escapeAction({ ...base, selection: [box] })).toBe('clear-boxes')
  })

  it('picks what Delete acts on from the selections', () => {
    const base = { selection: [], timelineSelection: null, shotSelection: [] }
    expect(deleteAction({ ...base, timelineSelection: { kind: 'zoom', id: 'z' }, shotSelection: ['a'] })).toBe('delete-zoom')
    expect(deleteAction({ ...base, timelineSelection: { kind: 'range', start: 0, end: 1 }, shotSelection: ['a'] })).toBe('cut-range')
    expect(deleteAction({ ...base, selection: [box] })).toBe('remove-boxes')
    expect(deleteAction({ ...base, shotSelection: ['a'] })).toBe('delete-shots')
  })
})
