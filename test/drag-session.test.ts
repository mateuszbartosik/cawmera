import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DOC, type Doc } from '../src/renderer/src/app/doc'
import {
  addShot,
  beginGesture,
  endGesture,
  liveShots,
  pickShotsInArea,
  redo,
  removeShots,
  restoreShots,
  selectShot,
  store,
  toggleShotPicked,
  undo,
  updateDoc
} from '../src/renderer/src/app/store'
import { dragSession } from '../src/renderer/src/timeline/drag-session'

const turnTo = (angle: number) => updateDoc({ angle }, { history: false })
const shot = (id: string) => liveShots().find((record) => record.id === id)!

beforeEach(() => {
  // A test that failed may have left its gesture open.
  endGesture(beginGesture())
  const doc: Doc = { ...DEFAULT_DOC, angle: 0 }
  const other: Doc = { ...DEFAULT_DOC, angle: 90 }
  store.set({
    shots: [
      { id: 'a', doc, past: [], future: [], savedDoc: null },
      { id: 'b', doc: other, past: [], future: [], savedDoc: null }
    ],
    activeId: 'a',
    doc,
    past: [],
    future: [],
    savedDoc: null,
    selection: [],
    timelineSelection: null,
    shotSelection: []
  })
})

describe('a drag session', () => {
  it('records one undo step however many edits and ends it has', () => {
    const before = store.get().doc
    const drag = dragSession()
    drag.begin()
    turnTo(10)
    turnTo(20)
    drag.end()
    drag.end()
    expect(store.get().past).toEqual([before])
    expect(store.get().doc.angle).toBe(20)
  })

  it('ends on a move with no button pressed', () => {
    const drag = dragSession()
    drag.begin()
    turnTo(10)
    expect(drag.accepts(1)).toBe(true)
    expect(drag.accepts(0)).toBe(false)
    expect(drag.isOpen).toBe(false)
    expect(store.get().past).toHaveLength(1)
  })

  it('puts the shot back as it was, with no undo step, when cancelled', () => {
    const before = store.get().doc
    const drag = dragSession()
    drag.begin()
    turnTo(10)
    drag.cancel()
    expect(store.get().doc).toBe(before)
    expect(store.get().past).toEqual([])
  })

  it.each([
    ['another shot is selected', () => selectShot('b')],
    ['another shot is Shift-clicked', () => toggleShotPicked('b')],
    ['another shot is picked by area', () => pickShotsInArea(['b'], false)],
    ['a shot is added', () => void addShot()]
  ])('commits into the shot it began on when %s, leaving the new active shot’s history alone', (_, switchShots) => {
    const before = store.get().doc
    const drag = dragSession()
    drag.begin()
    turnTo(10)
    const dragged = store.get().doc
    switchShots()
    const shown = store.get().doc
    expect(store.get().activeId).not.toBe('a')
    expect(store.get().past).toEqual([])
    expect(drag.accepts(1)).toBe(false)
    drag.edit(() => turnTo(45))
    drag.end()
    expect(store.get().doc).toBe(shown)
    expect(store.get().past).toEqual([])
    expect(shot('a')).toMatchObject({ doc: dragged, past: [before] })
  })

  it('commits into the shot it began on when that shot is deleted, so undoing the delete brings the step back', () => {
    const before = store.get().doc
    const drag = dragSession()
    drag.begin()
    turnTo(10)
    const dragged = store.get().doc
    const removed = removeShots(['a'])!
    expect(store.get().activeId).toBe('b')
    expect(store.get().past).toEqual([])
    const beforeOnB = store.get().doc
    const dragOnB = dragSession()
    dragOnB.begin()
    turnTo(45)
    restoreShots(removed)
    expect(store.get().doc).toBe(dragged)
    expect(store.get().past).toEqual([before])
    expect(shot('b').past).toEqual([beforeOnB])
  })

  it('commits into its own shot, never the active one, if a switch went around the store', () => {
    const before = store.get().doc
    const drag = dragSession()
    drag.begin()
    turnTo(10)
    const dragged = store.get().doc
    const other = shot('b').doc
    store.set({
      shots: [
        { id: 'a', doc: dragged, past: [], future: [], savedDoc: null },
        { id: 'b', doc: other, past: [], future: [], savedDoc: null }
      ],
      activeId: 'b',
      doc: other,
      past: [],
      future: []
    })
    drag.end()
    expect(store.get().past).toEqual([])
    expect(store.get().shots[0].past).toEqual([before])
  })

  it('is committed before Undo, which then takes it back', () => {
    const before = store.get().doc
    const drag = dragSession()
    drag.begin()
    turnTo(10)
    const dragged = store.get().doc
    undo()
    expect(store.get().doc).toBe(before)
    expect(store.get().future).toEqual([dragged])
    expect(drag.accepts(1)).toBe(false)
    drag.end()
    redo()
    expect(store.get().doc).toBe(dragged)
  })

  it('is committed before Redo, which then has nothing left to redo', () => {
    updateDoc({ angle: 5 })
    undo()
    const before = store.get().doc
    const drag = dragSession()
    drag.begin()
    turnTo(10)
    const dragged = store.get().doc
    redo()
    expect(store.get().doc).toBe(dragged)
    expect(store.get().past.at(-1)).toBe(before)
    expect(store.get().future).toEqual([])
  })

  it('is committed before an edit with history, as a step of its own before that edit’s', () => {
    const before = store.get().doc
    const drag = dragSession()
    drag.begin()
    turnTo(10)
    const dragged = store.get().doc
    updateDoc({ redactions: [] })
    expect(store.get().past).toEqual([before, dragged])
    expect(drag.accepts(1)).toBe(false)
    undo()
    expect(store.get().doc).toBe(dragged)
    undo()
    expect(store.get().doc).toBe(before)
  })

  it('edits nothing once the store has closed it, until its slider or key run ends', () => {
    const before = store.get().doc
    const slider = dragSession()
    slider.edit(() => turnTo(10))
    undo()
    slider.edit(() => turnTo(20))
    expect(store.get().doc).toBe(before)
    slider.end()
    slider.edit(() => turnTo(30))
    slider.end()
    expect(store.get().doc.angle).toBe(30)
    expect(store.get().past).toEqual([before])
    expect(store.get().future).toEqual([])
  })

  it('commits the gesture still open when another begins', () => {
    const before = store.get().doc
    const first = dragSession()
    first.begin()
    turnTo(10)
    const turned = store.get().doc
    const second = dragSession()
    second.edit(() => turnTo(20))
    expect(first.accepts(1)).toBe(false)
    first.edit(() => turnTo(99))
    second.end()
    expect(store.get().doc.angle).toBe(20)
    expect(store.get().past).toEqual([before, turned])
  })
})
