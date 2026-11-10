import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DOC, type Doc } from '../src/renderer/src/app/doc'
import { addShot, selectShot, store, undo, updateDoc, validTimelineSelection } from '../src/renderer/src/app/store'
import { setPlaying } from '../src/renderer/src/recording/playback'
import { DEFAULT_RECORDING } from '../src/renderer/src/recording/settings'
import { wholeTake } from '../src/renderer/src/recording/timemap'

const recordingDoc = (durationMs: number): Doc => ({
  ...DEFAULT_DOC,
  sourceId: 'take',
  recording: { ...DEFAULT_RECORDING, trim: { start: 0, end: durationMs }, pieces: wholeTake(durationMs) }
})

const box = { kind: 'redaction', id: 'box' } as const

beforeEach(() => {
  const doc = recordingDoc(10_000)
  const record = { id: 'take', doc, past: [], future: [], savedDoc: null }
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
