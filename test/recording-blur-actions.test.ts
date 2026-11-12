import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordingEntry } from '../src/renderer/src/recording/registry'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

const { addRedaction, removeSelected } = await import('../src/renderer/src/app/actions')
const { beginGesture, emptyDoc, endGesture, store, undo, updateDoc } = await import('../src/renderer/src/app/store')
const { currentPlayhead, scrubTo, setPlaying } = await import('../src/renderer/src/recording/playback')
const { registerRecording } = await import('../src/renderer/src/recording/registry')
const { DEFAULT_RECORDING } = await import('../src/renderer/src/recording/settings')
const { wholeTake } = await import('../src/renderer/src/recording/timemap')
const { dragSession } = await import('../src/renderer/src/timeline/drag-session')
const { showsWideFrame } = await import('../src/renderer/src/recording/zoom-actions')
const { addDrawnRedaction, moveRedactionTo, selectRedaction, stretchRedactionTo } = await import('../src/renderer/src/recording/blur-actions')

const entry: RecordingEntry = {
  id: 'blur-take',
  name: 'Take',
  track: { kind: 'monitor', width: 1920, height: 1080, fps: 60, durationMs: 10_000, scale: 1, cursor: [], clicks: [] },
  poster: null
}
const box = { id: 'box', rect: { x: 100, y: 100, w: 300, h: 80 }, time: { start: 3000, end: 4000 } }

beforeEach(() => {
  endGesture(beginGesture())
  registerRecording(entry)
  updateDoc(
    {
      ...emptyDoc(),
      sourceId: entry.id,
      redactions: [box],
      recording: { ...DEFAULT_RECORDING, trim: { start: 500, end: 9000 }, pieces: wholeTake(10_000), zooms: null }
    },
    { history: false }
  )
  store.set({ past: [], future: [], selection: [], timelineSelection: null, playback: { playing: false, time: 0 } })
  scrubTo(0)
})

const stored = () => store.get().doc.redactions[0].time!

describe('selecting a blur box', () => {
  it('selects it and seeks to its start when the playhead is outside its range', () => {
    selectRedaction('box')
    expect(store.get().selection).toEqual([{ kind: 'redaction', id: 'box' }])
    expect(currentPlayhead()).toBe(3000)
  })

  it('leaves the playhead alone inside the range', () => {
    scrubTo(3500)
    selectRedaction('box')
    expect(currentPlayhead()).toBe(3500)
  })

  it('pauses playback', () => {
    setPlaying(true)
    selectRedaction('box')
    expect(store.get().playback.playing).toBe(false)
    expect(store.get().selection).toEqual([{ kind: 'redaction', id: 'box' }])
  })

  it('drops the timeline selection', () => {
    store.set({ timelineSelection: { kind: 'zoom', id: 'z' } })
    selectRedaction('box')
    expect(store.get().timelineSelection).toBeNull()
  })

  it('deletes with the existing remove action', () => {
    selectRedaction('box')
    removeSelected()
    expect(store.get().doc.redactions).toEqual([])
  })
})

describe('moving and stretching a blur box', () => {
  it('records one undo step however many moves a drag makes', () => {
    const session = dragSession()
    session.begin()
    moveRedactionTo('box', 4000, false)
    moveRedactionTo('box', 5000, false)
    session.end()
    expect(stored().start).toBeCloseTo(5000, 0)
    expect(stored().end - stored().start).toBeCloseTo(1000, 6)
    expect(store.get().past).toHaveLength(1)
    undo()
    expect(stored()).toEqual({ start: 3000, end: 4000 })
  })

  it('stretches an edge and keeps the other', () => {
    stretchRedactionTo('box', 'end', 6000)
    expect(stored().start).toBe(3000)
    expect(stored().end).toBeCloseTo(6000, 0)
  })

  it('makes no undo step when nothing changes', () => {
    moveRedactionTo('box', 3000)
    expect(store.get().past).toEqual([])
  })
})

describe('adding a box on a recording', () => {
  it('runs from the playhead to the end of the trim, centred, and selects it', () => {
    scrubTo(2000)
    addRedaction()
    const added = store.get().doc.redactions[1]
    expect(added.time!.start).toBeCloseTo(2000, 0)
    expect(added.time!.end).toBeCloseTo(9000, 0)
    expect(added.rect.x + added.rect.w / 2).toBeCloseTo(960 + 12, 0)
    expect(store.get().selection).toEqual([{ kind: 'redaction', id: added.id }])
  })
})

describe('drawing a box on a recording', () => {
  const drawn = { x: 40, y: 60, w: 200, h: 90 }

  it('gets its time from the playhead, joins the open drag without an undo step, and is selected', () => {
    scrubTo(2000)
    const id = addDrawnRedaction(drawn)
    const added = store.get().doc.redactions[1]
    expect(added.id).toBe(id)
    expect(added.rect).toEqual(drawn)
    expect(added.time!.start).toBeCloseTo(2000, 0)
    expect(added.time!.end).toBeCloseTo(9000, 0)
    expect(store.get().selection).toEqual([{ kind: 'redaction', id }])
    expect(store.get().past).toHaveLength(0)
  })

  it('pauses playback and clears a zoom selection', () => {
    setPlaying(true)
    store.set({ timelineSelection: { kind: 'zoom', id: 'z' } })
    addDrawnRedaction(drawn)
    expect(store.get().playback.playing).toBe(false)
    expect(store.get().timelineSelection).toBeNull()
  })

  it('makes one undo step with the rest of its drag', () => {
    const session = dragSession()
    session.begin()
    const id = addDrawnRedaction(drawn)!
    updateDoc((doc) => ({ redactions: doc.redactions.map((r) => (r.id === id ? { ...r, rect: { ...drawn, w: 300 } } : r)) }), { history: false })
    session.end()
    expect(store.get().past).toHaveLength(1)
    undo()
    expect(store.get().doc.redactions).toHaveLength(1)
  })
})

describe('showsWideFrame', () => {
  const zoom = { id: 'z', start: 1000, end: 2000, depth: 2, aim: 'manual' as const, focus: { x: 10, y: 10 } }

  it('is wide for a selected blur box or zoom, and not for a spotlight alone', () => {
    expect(showsWideFrame([{ kind: 'redaction', id: 'box' }], [], null)).toBe(true)
    expect(showsWideFrame([], [zoom], { kind: 'zoom', id: 'z' })).toBe(true)
    expect(showsWideFrame([{ kind: 'spotlight' }], [zoom], null)).toBe(false)
    expect(showsWideFrame([], [zoom], { kind: 'range', start: 0, end: 500 })).toBe(false)
  })
})
