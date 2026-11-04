import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DOC, type Doc } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE, HOUSE_STYLE_VERSION, loadHouseStyle, sanitizeHouseStyle, serializeHouseStyle } from '../src/renderer/src/app/house-style'
import {
  clearPickedShots,
  liveShots,
  pickAllShots,
  pickShotsInArea,
  removeShots,
  restoreShots,
  selectShot,
  store,
  toggleShotPicked,
  type ShotRecord
} from '../src/renderer/src/app/store'

const framed = (name: string): Doc => ({ ...DEFAULT_DOC, sourceId: `source-${name}`, fileName: name })
const empty = (): Doc => ({ ...DEFAULT_DOC })

/** Fresh shots named A, B, C… (null: an empty shot), the first one active. */
function setShots(...names: (string | null)[]) {
  const shots: ShotRecord[] = names.map((name, i) => ({ id: name ?? `empty-${i}`, doc: name ? framed(name) : empty(), past: [], future: [], savedDoc: null }))
  store.set({ shots, activeId: shots[0].id, doc: shots[0].doc, past: [], future: [], savedDoc: null, selection: [], shotSelection: [], mode: 'compose' })
}
const order = () => liveShots().map((record) => record.id)
const picked = () => store.get().shotSelection
const active = () => store.get().activeId

describe('picking shots', () => {
  beforeEach(() => setShots('A', 'B', 'C', 'D'))

  it('Shift-click picks the active shot and the clicked one, and the clicked one becomes active', () => {
    toggleShotPicked('C')
    expect(picked()).toEqual(['A', 'C'])
    expect(active()).toBe('C')
    toggleShotPicked('D')
    expect(picked()).toEqual(['A', 'C', 'D'])
    expect(active()).toBe('D')
    // Taking out the active shot hands the panel to the one picked last.
    toggleShotPicked('D')
    expect(picked()).toEqual(['C', 'A'])
    expect(active()).toBe('C')
    toggleShotPicked('A')
    toggleShotPicked('C')
    expect(picked()).toEqual([])
    expect(active()).toBe('C')
  })

  it('Shift-click on the active shot picks just that one', () => {
    toggleShotPicked('A')
    expect(picked()).toEqual(['A'])
    expect(active()).toBe('A')
  })

  it('a drag over the canvas picks what it touches, or adds to it with Shift', () => {
    pickShotsInArea(['B', 'C'], false)
    expect(picked()).toEqual(['B', 'C'])
    expect(active()).toBe('B')
    pickShotsInArea(['D'], true)
    expect(picked()).toEqual(['B', 'C', 'D'])
    expect(active()).toBe('B')
    pickShotsInArea([], false)
    expect(picked()).toEqual([])
  })

  it('Ctrl+A picks every shot; a plain click or Esc lets go', () => {
    pickAllShots()
    expect(picked()).toEqual(['A', 'B', 'C', 'D'])
    selectShot('A')
    expect(picked()).toEqual([])
    pickAllShots()
    clearPickedShots()
    expect(picked()).toEqual([])
  })
})

describe('deleting several shots', () => {
  it('removes them at once and Undo puts each back in its place, picked again', () => {
    setShots('A', 'B', 'C', 'D')
    // A is active, so Shift-clicking B and D picks A, B and D.
    toggleShotPicked('B')
    toggleShotPicked('D')
    const removed = removeShots(picked())!
    expect(order()).toEqual(['C'])
    expect(active()).toBe('C')
    restoreShots(removed)
    expect(order()).toEqual(['A', 'B', 'C', 'D'])
    expect([...picked()].sort()).toEqual(['A', 'B', 'D'])
  })

  it('deleting every shot leaves one empty shot, which Undo takes away again', () => {
    setShots('A', 'B')
    const removed = removeShots(['A', 'B'])!
    const left = liveShots()
    expect(left).toHaveLength(1)
    expect(left[0].doc.sourceId).toBeNull()
    restoreShots(removed)
    expect(order()).toEqual(['A', 'B'])
  })

  it('Undo keeps an empty shot that was already there', () => {
    setShots('A', null)
    const removed = removeShots(['A'])!
    expect(order()).toEqual(['empty-1'])
    restoreShots(removed)
    expect(order()).toEqual(['A', 'empty-1'])
  })
})

describe('light intensity', () => {
  it('starts every shot at 100%, the house strength', () => {
    expect(DEFAULT_DOC.lightIntensity).toBe(1)
    expect(DEFAULT_HOUSE_STYLE.glowStrength).toBeGreaterThan(0)
  })

  it('keeps the name a shared style carries, trimmed', () => {
    expect(loadHouseStyle({ ...serializeHouseStyle(DEFAULT_HOUSE_STYLE), name: '  Acme  ' }).name).toBe('Acme')
    expect(loadHouseStyle({ glow: '#123456' }).name).toBe('')
    expect(loadHouseStyle({ name: 'x'.repeat(60) }).name).toHaveLength(40)
  })

  it('upgrades a house style saved by an older version, and leaves current ones alone', () => {
    expect(loadHouseStyle({ ...DEFAULT_HOUSE_STYLE, glowStrength: 0.16 }).glowStrength).toBeCloseTo(0.32)
    expect(loadHouseStyle({ ...DEFAULT_HOUSE_STYLE, version: 2, glowStrength: 0.2 }).glowStrength).toBeCloseTo(0.2)
    expect(serializeHouseStyle(DEFAULT_HOUSE_STYLE).version).toBe(HOUSE_STYLE_VERSION)
    expect(loadHouseStyle(serializeHouseStyle(DEFAULT_HOUSE_STYLE))).toEqual(DEFAULT_HOUSE_STYLE)
    expect(sanitizeHouseStyle({ glowStrength: 3 }).glowStrength).toBe(1)
  })
})
