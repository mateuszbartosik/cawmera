import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { RecordingEntry } from '../src/renderer/src/recording/registry'
import type { Piece, Rate } from '../src/renderer/src/recording/timemap'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

const { deleteAction } = await import('../src/renderer/src/app/selection-keys')
const { beginGesture, emptyDoc, endGesture, store, undo, updateDoc } = await import('../src/renderer/src/app/store')
const { cutSelection, rangeAt, rangeHasCut, rateOfRange, restoreSelection, selectRange, setSelectionRate, splitAtPlayhead } = await import(
  '../src/renderer/src/recording/edit-actions'
)
const { scrubTo } = await import('../src/renderer/src/recording/playback')
const { registerRecording } = await import('../src/renderer/src/recording/registry')
const { DEFAULT_RECORDING } = await import('../src/renderer/src/recording/settings')
const { wholeTake } = await import('../src/renderer/src/recording/timemap')

const piece = (start: number, end: number, rate: Rate = 1, cut = false): Piece => ({ start, end, rate, cut })

function openTake(durationMs: number) {
  const entry: RecordingEntry = {
    id: 'edit-take',
    name: 'Take',
    track: { kind: 'monitor', width: 1920, height: 1080, fps: 60, durationMs, scale: 1, cursor: [], clicks: [] },
    poster: null
  }
  registerRecording(entry)
  updateDoc(
    {
      ...emptyDoc(),
      sourceId: entry.id,
      recording: { ...DEFAULT_RECORDING, trim: { start: 0, end: durationMs }, pieces: wholeTake(durationMs), zooms: null }
    },
    { history: false }
  )
  store.set({ past: [], future: [], selection: [], timelineSelection: null, playback: { playing: false, time: 0 } })
}

const pieces = () => store.get().doc.recording!.pieces

beforeEach(() => {
  vi.clearAllMocks()
  endGesture(beginGesture())
})

describe('edit actions', () => {
  it('finds the piece under a time, inside the trim', () => {
    expect(rangeAt([piece(0, 4000), piece(4000, 10_000)], { start: 1000, end: 9000 }, 5000)).toEqual({ start: 4000, end: 9000 })
  })

  it('cuts the selected stretch in one undo step', () => {
    openTake(10_000)
    selectRange({ start: 4000, end: 6000 })
    cutSelection()
    expect(pieces()).toEqual([piece(0, 4000), piece(4000, 6000, 1, true), piece(6000, 10_000)])
    undo()
    expect(pieces()).toEqual(wholeTake(10_000))
  })

  it('refuses a cut that leaves too little, and says why', () => {
    openTake(10_000)
    selectRange({ start: 0, end: 9800 })
    cutSelection()
    expect(pieces()).toEqual(wholeTake(10_000))
    expect(toast).toHaveBeenCalledWith('Keep at least half a second of the recording')
    expect(store.get().past).toEqual([])
  })

  it('splits at the playhead and speeds up the selection', () => {
    openTake(10_000)
    scrubTo(3000)
    splitAtPlayhead()
    selectRange({ start: 3000, end: 10_000 })
    setSelectionRate(4)
    expect(pieces()).toEqual([piece(0, 3000), piece(3000, 10_000, 4)])
  })

  it('refuses a speed-up that would play under half a second', () => {
    openTake(4000)
    selectRange({ start: 0, end: 4000 })
    setSelectionRate(8)
    expect(pieces()).toEqual([piece(0, 4000, 8)])
    expect(toast).not.toHaveBeenCalled()
    openTake(2000)
    selectRange({ start: 0, end: 2000 })
    setSelectionRate(8)
    expect(pieces()).toEqual(wholeTake(2000))
    expect(toast).toHaveBeenCalledWith('Keep at least half a second of the recording')
  })

  it('restores a cut stretch', () => {
    openTake(10_000)
    selectRange({ start: 4000, end: 6000 })
    cutSelection()
    expect(rangeHasCut(pieces(), { start: 4000, end: 6000 })).toBe(true)
    restoreSelection()
    expect(pieces()).toEqual([piece(0, 4000), piece(4000, 6000), piece(6000, 10_000)])
  })

  it('does not split next to a boundary', () => {
    openTake(10_000)
    scrubTo(30)
    splitAtPlayhead()
    expect(pieces()).toEqual(wholeTake(10_000))
    expect(store.get().past).toEqual([])
  })

  it('edits nothing without a selected range', () => {
    openTake(10_000)
    cutSelection()
    setSelectionRate(2)
    expect(pieces()).toEqual(wholeTake(10_000))
  })

  it('reports the shared rate of a range, or none when they differ', () => {
    const mixed = [piece(0, 1000, 2), piece(1000, 2000, 4)]
    expect(rateOfRange(mixed, { start: 0, end: 900 })).toBe(2)
    expect(rateOfRange(mixed, { start: 0, end: 2000 })).toBeNull()
  })

  it('makes Delete cut a selected range', () => {
    const base = { selection: [], shotSelection: [] }
    expect(deleteAction({ ...base, timelineSelection: { kind: 'range', start: 0, end: 1 } })).toBe('cut-range')
  })
})
