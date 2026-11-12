import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { Click } from '../src/renderer/src/recording/track'
import type { RecordingEntry } from '../src/renderer/src/recording/registry'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

const { deleteAction } = await import('../src/renderer/src/app/selection-keys')
const { emptyDoc, store, undo, updateDoc, commitFrom } = await import('../src/renderer/src/app/store')
const { registerRecording } = await import('../src/renderer/src/recording/registry')
const { DEFAULT_RECORDING } = await import('../src/renderer/src/recording/settings')
const { wholeTake } = await import('../src/renderer/src/recording/timemap')
const { setZoom } = await import('../src/renderer/src/recording/zoom-edits')
const {
  addZoomAt,
  currentZoomEdits,
  deleteSelectedZoom,
  editZooms,
  moveSelectedZoom,
  resetZooms,
  selectZoom,
  setSelectedZoom,
  stretchSelectedZoom,
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
  store.set({ past: [], future: [], selection: [], timelineSelection: null })
}

const storedZooms = () => store.get().doc.recording!.zooms

beforeEach(() => {
  vi.clearAllMocks()
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
    moveSelectedZoom(startedAt + 100, false)
    moveSelectedZoom(startedAt + 200, false)
    moveSelectedZoom(startedAt + 300, false)
    expect(store.get().past).toEqual([])
    commitFrom(before)
    expect(store.get().past).toEqual([before])
    expect(currentZoomEdits()[1].start).toBe(startedAt + 300)
    expect(store.get().timelineSelection).toEqual({ kind: 'zoom', id: currentZoomEdits()[1].id })
    undo()
    expect(storedZooms()).toBeNull()
  })

  it('stretches the selected zoom’s edge', () => {
    selectZoom('auto-1')
    const { end } = currentZoomEdits()[1]
    stretchSelectedZoom('end', end + 500)
    expect(currentZoomEdits()[1].end).toBe(end + 500)
  })

  it('does not edit with no zoom selected', () => {
    moveSelectedZoom(100)
    stretchSelectedZoom('end', 100)
    deleteSelectedZoom()
    expect(storedZooms()).toBeNull()
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
    expect(storedZooms()![0]).toMatchObject({ depth: 5, aim: 'manual' })
  })

  it('words the aim hint for the clicks a zoom covers', () => {
    expect(zoomHint('auto', 5)).toBe('Auto keeps this zoom’s 5 clicks in view.')
    expect(zoomHint('auto', 1)).toBe('Auto keeps this zoom’s click in view.')
    expect(zoomHint('manual', 0)).toBe('No clicks in this zoom. Drag its area on the shot to aim it.')
    expect(zoomHint('manual', 3)).toBe('Drag the area on the shot to aim it.')
  })
})

