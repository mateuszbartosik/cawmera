import { describe, expect, it } from 'vitest'
import { playheadDragger, playheadLineX } from '../src/renderer/src/timeline/playhead-drag'

const view = { start: 10_000, end: 20_000 }
const take = { start: 0, end: 60_000 }

describe('dragging the playhead', () => {
  it('keeps where on the handle the press landed, so the playhead doesn’t jump', () => {
    const drag = playheadDragger()
    drag.press(406, 400)
    expect(drag.move(406, view, 800, take, 60_000).time).toBe(15_000)
    expect(drag.move(506, view, 800, take, 60_000).time).toBe(16_250)
    expect(drag.move(306, view, 800, take, 60_000).time).toBe(13_750)
  })

  it('jumps to the pointer from a ruler press, which is a seek', () => {
    const drag = playheadDragger()
    drag.press(300)
    expect(drag.move(300, view, 800, take, 60_000)).toEqual({ time: 13_750, view })
  })

  it('scrolls by the pointer’s own travel past the edge, wherever on the handle it was pressed', () => {
    const drag = playheadDragger()
    drag.press(794, 800)
    expect(drag.move(794, view, 800, take, 60_000)).toEqual({ time: 20_000, view })
    const pushed = drag.move(874, view, 800, take, 60_000)
    expect(pushed).toEqual({ time: 21_000, view: { start: 11_000, end: 21_000 } })
    expect(drag.move(874, pushed.view, 800, take, 60_000).view).toBe(pushed.view)
  })
})

describe('the playhead line', () => {
  it('is drawn within half a pixel of the view, at the nearest edge', () => {
    expect(playheadLineX(400, 800, false)).toBe(400)
    expect(playheadLineX(800.0000000000043, 800, false)).toBe(800)
    expect(playheadLineX(-0.4, 800, false)).toBe(0)
    expect(playheadLineX(800.6, 800, false)).toBeNull()
    expect(playheadLineX(-1, 800, false)).toBeNull()
  })

  it('stays at the nearest edge while its own drag holds it, wherever the playhead went', () => {
    expect(playheadLineX(1500, 800, true)).toBe(800)
    expect(playheadLineX(-200, 800, true)).toBe(0)
  })
})
