import { describe, expect, it } from 'vitest'
import { dragTarget, drawnBlock, EDGE_GRAB_PX, grabAt, isBlockVisible, MIN_ZOOM_BLOCK_PX } from '../src/renderer/src/timeline/zoom-drag'
import type { ZoomEdit } from '../src/renderer/src/recording/zoom-edits'

const view = { start: 0, end: 10_000 }
const width = 1000
const zoomOf = (start: number, end: number): ZoomEdit => ({ id: 'z', start, end, depth: 2, aim: 'manual', focus: { x: 0, y: 0 } })
const wide = zoomOf(2000, 6000)

describe('zoom block drag', () => {
  it('draws a block no narrower than the grabbable minimum', () => {
    expect(drawnBlock(wide, view, width)).toEqual({ left: 200, width: 400 })
    expect(drawnBlock(zoomOf(2000, 2100), view, width).width).toBe(MIN_ZOOM_BLOCK_PX)
  })

  it('tells visible blocks from the ones scrolled out of the row', () => {
    expect(isBlockVisible({ left: -50, width: 100 }, width)).toBe(true)
    expect(isBlockVisible({ left: -100, width: 100 }, width)).toBe(false)
    expect(isBlockVisible({ left: width, width: 100 }, width)).toBe(false)
  })

  it('takes the ends for stretching and the middle for moving', () => {
    expect(grabAt(wide, 200 + EDGE_GRAB_PX - 1, view, width).kind).toBe('start')
    expect(grabAt(wide, 600 - EDGE_GRAB_PX + 1, view, width).kind).toBe('end')
    expect(grabAt(wide, 400, view, width).kind).toBe('move')
  })

  it('moves by the distance the pointer travels from where it took hold', () => {
    const grab = grabAt(wide, 400, view, width)
    expect(dragTarget(grab, 400, view, width)).toBe(wide.start)
    expect(dragTarget(grab, 450, view, width)).toBe(wide.start + 500)
  })

  it('does not jump the end of a block drawn wider than its zoom', () => {
    const narrow = zoomOf(2000, 2100)
    const block = drawnBlock(narrow, view, width)
    const x = block.left + block.width - 2
    const grab = grabAt(narrow, x, view, width)
    expect(grab.kind).toBe('end')
    expect(dragTarget(grab, x, view, width)).toBe(narrow.end)
    expect(dragTarget(grab, x + 10, view, width)).toBe(narrow.end + 100)
  })
})
