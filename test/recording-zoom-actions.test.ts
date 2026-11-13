import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { Click } from '../src/renderer/src/recording/track'
import type { RecordingEntry } from '../src/renderer/src/recording/registry'
import type { Rect } from '../src/renderer/src/render/geometry'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

const { deleteAction } = await import('../src/renderer/src/app/selection-keys')
const { beginGesture, emptyDoc, endGesture, store, undo, updateDoc } = await import('../src/renderer/src/app/store')
const { dragSession } = await import('../src/renderer/src/timeline/drag-session')
const { registerRecording } = await import('../src/renderer/src/recording/registry')
const { DEFAULT_RECORDING } = await import('../src/renderer/src/recording/settings')
const { wholeTake } = await import('../src/renderer/src/recording/timemap')
const { takeViewFor } = await import('../src/renderer/src/recording/take-view')
const { clicksCovered, setZoom, ZOOM_DEPTH_RANGE } = await import('../src/renderer/src/recording/zoom-edits')
const { aimedArea, draggedFraming, moveArea, resizeArea } = await import('../src/renderer/src/recording/zoom-area')
const {
  addZoomAt,
  aimZoomByHand,
  currentZoomEdits,
  deleteSelectedZoom,
  editZooms,
  moveZoomTo,
  resetZooms,
  selectedZoomOf,
  selectZoom,
  autoAimAvailable,
  setSelectedZoom,
  stretchZoomTo,
  zoomAreaLabel,
  zoomHint
} = await import('../src/renderer/src/recording/zoom-actions')

const click = (t: number, x: number, y: number): Click => ({ t, x, y, button: 'left', up: t + 80 })
const entry: RecordingEntry = {
  id: 'zoom-take',
  name: 'Take',
  track: {
    kind: 'monitor',
    width: 1920,
    height: 1080,
    fps: 60,
    durationMs: 10_000,
    scale: 1,
    cursor: [
      { t: 0, x: 400, y: 300, shape: 'arrow' },
      { t: 10_000, x: 1400, y: 800, shape: 'arrow' }
    ],
    clicks: [click(2500, 500, 400), click(3000, 600, 450), click(7000, 1400, 800)]
  },
  poster: null
}

function openTakeWithTwoAutoZooms() {
  registerRecording(entry)
  updateDoc(
    {
      ...emptyDoc(),
      sourceId: entry.id,
      recording: { ...DEFAULT_RECORDING, smoothing: 0, trim: { start: 0, end: 10_000 }, pieces: wholeTake(10_000), zooms: null }
    },
    { history: false }
  )
  store.set({ past: [], future: [], selection: [], timelineSelection: null, playback: { playing: false, time: 0 } })
}

const storedZooms = () => store.get().doc.recording!.zooms

beforeEach(() => {
  vi.clearAllMocks()
  // A test that failed may have left its gesture open.
  endGesture(beginGesture())
  openTakeWithTwoAutoZooms()
})

describe('zoom actions', () => {
  it('starts from two automatic zooms', () => {
    expect(currentZoomEdits().map((edit) => edit.id)).toEqual(['auto-0', 'auto-1'])
  })

  it('stores the automatic zooms on the first edit and keeps the edited one selected', () => {
    selectZoom('auto-1')
    editZooms((edits, id) => setZoom(edits, id!, { depth: 2.4 }))
    const { doc, timelineSelection } = store.get()
    expect(doc.recording!.zooms).toHaveLength(2)
    expect(timelineSelection).toEqual({ kind: 'zoom', id: doc.recording!.zooms![1].id })
    expect(doc.recording!.zooms![1].depth).toBe(2.4)
  })

  it('changes nothing when the change is null or returns the same zooms', () => {
    selectZoom('auto-0')
    editZooms(() => null)
    editZooms((edits) => edits)
    expect(storedZooms()).toBeNull()
    expect(store.get().past).toEqual([])
  })

  it('stores no automatic zoom and adds no undo step for an edit that changes nothing', () => {
    selectZoom('auto-1')
    const { start, end, depth, aim } = currentZoomEdits()[1]
    setSelectedZoom({ depth, aim })
    stretchZoomTo('auto-1', 'end', end)
    stretchZoomTo('auto-1', 'start', start)
    const drag = dragSession()
    drag.begin()
    expect(moveZoomTo('auto-1', start, false)).toBe('auto-1')
    drag.end()
    expect(storedZooms()).toBeNull()
    expect(store.get().past).toEqual([])
    expect(store.get().timelineSelection).toEqual({ kind: 'zoom', id: 'auto-1' })
  })

  it('adds no undo step for a stored zoom set to what it already is', () => {
    selectZoom('auto-0')
    deleteSelectedZoom()
    const [zoom] = currentZoomEdits()
    selectZoom(zoom.id)
    const steps = store.get().past.length
    const zooms = storedZooms()
    setSelectedZoom({ depth: zoom.depth, aim: zoom.aim })
    moveZoomTo(zoom.id, zoom.start)
    expect(store.get().past).toHaveLength(steps)
    expect(storedZooms()).toBe(zooms)
  })

  it('undoes the first edit back to automatic zooms', () => {
    selectZoom('auto-0')
    deleteSelectedZoom()
    expect(storedZooms()).toHaveLength(1)
    expect(store.get().timelineSelection).toBeNull()
    undo()
    expect(storedZooms()).toBeNull()
  })

  it('goes back to automatic zooms', () => {
    selectZoom('auto-0')
    deleteSelectedZoom()
    resetZooms()
    expect(storedZooms()).toBeNull()
    expect(currentZoomEdits()).toHaveLength(2)
  })

  it('moves a zoom as one undo step however many moves the drag makes', () => {
    selectZoom('auto-1')
    const before = store.get().doc
    const startedAt = currentZoomEdits()[1].start
    const drag = dragSession()
    drag.begin()
    const followed = moveZoomTo('auto-1', startedAt + 100, false)
    expect(followed).toBe(currentZoomEdits()[1].id)
    expect(followed).not.toBe('auto-1')
    moveZoomTo(followed, startedAt + 200, false)
    moveZoomTo(followed, startedAt + 300, false)
    expect(store.get().past).toEqual([])
    drag.end()
    expect(store.get().past).toEqual([before])
    expect(currentZoomEdits()[1].start).toBe(startedAt + 300)
    expect(store.get().timelineSelection).toEqual({ kind: 'zoom', id: currentZoomEdits()[1].id })
    undo()
    expect(storedZooms()).toBeNull()
  })

  it('stretches the zoom it is given, selected or not', () => {
    selectZoom('auto-0')
    const { end } = currentZoomEdits()[1]
    stretchZoomTo('auto-1', 'end', end + 500)
    expect(currentZoomEdits()[1].end).toBe(end + 500)
  })

  it('keeps editing the dragged zoom after the selection moves elsewhere', () => {
    selectZoom('auto-1')
    const followed = moveZoomTo('auto-1', 5000, false)
    selectZoom(null)
    const moved = moveZoomTo(followed, 5200, false)
    expect(moved).toBe(followed)
    expect(currentZoomEdits().find((edit) => edit.id === followed)!.start).toBe(5200)
  })

  it('does not edit when a zoom is gone, or when nothing is selected for a selected edit', () => {
    moveZoomTo('gone', 100)
    stretchZoomTo('gone', 'end', 100)
    expect(aimZoomByHand('gone', { focus: { x: 100, y: 100 } })).toBe('gone')
    deleteSelectedZoom()
    setSelectedZoom({ depth: 2 })
    expect(storedZooms()).toBeNull()
  })

  it('does not replace the selection when it stays the same', () => {
    selectZoom('auto-1')
    const followed = moveZoomTo('auto-1', 5000, false)
    const selection = store.get().timelineSelection
    moveZoomTo(followed, 5100, false)
    expect(store.get().timelineSelection).toBe(selection)
  })

  it('adds a zoom aimed at the cursor, which sits on the clicks, and selects it', () => {
    addZoomAt(4500)
    const edits = currentZoomEdits()
    const added = edits.find((edit) => edit.aim === 'manual')!
    expect(added.start).toBe(4500)
    expect(added.focus.x).toBeCloseTo(900)
    expect(added.focus.y).toBeCloseTo(581.25)
    expect(store.get().timelineSelection).toEqual({ kind: 'zoom', id: added.id })
    expect(edits).toHaveLength(3)
  })

  it('aims a zoom added inside another at the cursor where it starts', () => {
    const [first] = currentZoomEdits()
    addZoomAt(first.end)
    const aimedAtItsStart = currentZoomEdits().find((edit) => edit.aim === 'manual')!
    undo()
    addZoomAt(first.start + 100)
    const added = currentZoomEdits().find((edit) => edit.aim === 'manual')!
    expect(added.start).toBe(first.end)
    expect(added.focus).toEqual(aimedAtItsStart.focus)
  })

  it('aims a new zoom at the frame centre when the take has no cursor', () => {
    registerRecording({ ...entry, id: 'no-cursor', track: { ...entry.track, cursor: [], clicks: [] } })
    updateDoc({ sourceId: 'no-cursor' }, { history: false })
    addZoomAt(1000)
    expect(currentZoomEdits()[0].focus).toEqual({ x: 960, y: 540 })
  })

  it('says so when there is no room for a zoom', () => {
    addZoomAt(9900)
    expect(toast).toHaveBeenCalledWith('No room for a zoom here')
    expect(storedZooms()).toBeNull()
  })

  it('treats a selected zoom as a timeline selection for Delete', () => {
    selectZoom('auto-0')
    expect(deleteAction(store.get())).toBe('delete-zoom')
  })

  it('sets depth and aim on the selected zoom', () => {
    selectZoom('auto-0')
    setSelectedZoom({ depth: 5, aim: 'manual' })
    expect(storedZooms()![0]).toMatchObject({ depth: 3, aim: 'manual' })
  })

  it('offers Auto aim only for a zoom that covers clicks', () => {
    expect(autoAimAvailable(0)).toBe(false)
    expect(autoAimAvailable(1)).toBe(true)
  })

  it('words the aim hint for the clicks a zoom covers', () => {
    expect(zoomHint('auto', 5)).toBe('Auto keeps this zoom’s 5 clicks in view.')
    expect(zoomHint('auto', 1)).toBe('Auto keeps this zoom’s click in view.')
    expect(zoomHint('manual', 0)).toBe('No clicks in this zoom. Drag its area on the shot to aim it.')
    expect(zoomHint('manual', 3)).toBe('Drag the area on the shot to aim it.')
  })

  it('labels a zoom’s area with its depth and aim', () => {
    expect(zoomAreaLabel({ depth: 2, aim: 'auto' })).toBe('2.0× · Auto')
    expect(zoomAreaLabel({ depth: 2.4, aim: 'manual' })).toBe('2.4× · Manual')
  })

  it('counts a selected zoom only while the take shows it', () => {
    const edits = currentZoomEdits()
    expect(selectedZoomOf(edits, { kind: 'zoom', id: 'auto-1' })).toBe(edits[1])
    expect(selectedZoomOf(edits, { kind: 'zoom', id: 'auto-7' })).toBeNull()
    expect(selectedZoomOf(edits, { kind: 'range', start: 0, end: 1000 })).toBeNull()
  })

  it('aims a zoom by hand as one undo step, turning it Manual', () => {
    selectZoom('auto-1')
    const before = store.get().doc
    const drag = dragSession()
    drag.begin()
    const followed = aimZoomByHand('auto-1', { focus: { x: 1300, y: 700 } }, false)
    expect(followed).not.toBe('auto-1')
    const depth = currentZoomEdits()[1].depth
    expect(aimZoomByHand(followed, { focus: { x: 1200, y: 650 }, depth: 2.6 }, false)).toBe(followed)
    expect(store.get().past).toEqual([])
    drag.end()
    expect(store.get().past).toEqual([before])
    expect(currentZoomEdits()[1]).toMatchObject({ id: followed, focus: { x: 1200, y: 650 }, depth: 2.6, aim: 'manual' })
    expect(depth).not.toBe(2.6)
    expect(store.get().timelineSelection).toEqual({ kind: 'zoom', id: followed })
    undo()
    expect(storedZooms()).toBeNull()
  })

  it('shows a dragged area where it was dragged, from Auto on', () => {
    const view = () => takeViewFor(entry, store.get().doc.recording!, null)
    const shownArea = () => {
      const zoom = selectedZoomOf(view().edits)!
      return aimedArea(zoom, clicksCovered(zoom, view(), 'calm'), view(), 2600).area
    }
    const expectArea = (actual: Rect, expected: Rect) => {
      for (const key of ['x', 'y', 'w', 'h'] as const) expect(actual[key]).toBeCloseTo(expected[key], 6)
    }
    selectZoom('auto-0')
    const start = shownArea()
    aimZoomByHand('auto-0', draggedFraming(start, 'move', 100, 50, view()))
    expectArea(shownArea(), moveArea(start, 100, 50, view().frame))
    const moved = shownArea()
    aimZoomByHand(selectedZoomOf(view().edits)!.id, draggedFraming(moved, 'se', 120, 0, view()))
    expectArea(shownArea(), resizeArea(moved, 'se', 120, 0, view().frame, ZOOM_DEPTH_RANGE))
  })

  it('moves a zoom’s focus without changing its depth', () => {
    const { depth } = currentZoomEdits()[0]
    aimZoomByHand('auto-0', { focus: { x: 700, y: 400 } })
    expect(storedZooms()![0]).toMatchObject({ depth, focus: { x: 700, y: 400 }, aim: 'manual' })
  })

  it('commits an area drag before Delete, as a step of its own', () => {
    selectZoom('auto-1')
    const before = store.get().doc
    const drag = dragSession()
    drag.begin()
    aimZoomByHand('auto-1', { focus: { x: 1300, y: 700 } }, false)
    const dragged = store.get().doc
    deleteSelectedZoom()
    expect(store.get().past).toEqual([before, dragged])
    expect(drag.accepts(1)).toBe(false)
    undo()
    expect(store.get().doc).toBe(dragged)
    undo()
    expect(storedZooms()).toBeNull()
  })

  it('pauses playback when a zoom is selected, so playback never shows the wide frame', () => {
    store.set({ playback: { playing: true, time: 2000 } })
    selectZoom('auto-1')
    expect(store.get().playback.playing).toBe(false)
    expect(store.get().timelineSelection).toEqual({ kind: 'zoom', id: 'auto-1' })
    store.set({ playback: { playing: true, time: 2000 } })
    addZoomAt(4500)
    expect(store.get().playback.playing).toBe(false)
  })

  it('keeps playing when a zoom selection is cleared', () => {
    selectZoom('auto-1')
    store.set({ playback: { playing: true, time: 2000 } })
    selectZoom(null)
    expect(store.get().playback.playing).toBe(true)
    expect(store.get().timelineSelection).toBeNull()
  })
})

