import { describe, expect, it } from 'vitest'
import { moveSpan, stretchSpan } from '../src/renderer/src/timeline/scale'

const bounds = { start: 0, end: 10_000 }

describe('moveSpan', () => {
  it('moves a span inside its bounds', () => {
    expect(moveSpan({ start: 2000, end: 3000 }, 9500, bounds)).toEqual({ start: 9000, end: 10_000 })
    expect(moveSpan({ start: 2000, end: 3000 }, 8500, bounds)).toEqual({ start: 8500, end: 9500 })
    expect(moveSpan({ start: 2000, end: 3000 }, -400, bounds)).toEqual({ start: 0, end: 1000 })
    expect(moveSpan({ start: 2000, end: 3000 }, 4000, bounds)).toEqual({ start: 4000, end: 5000 })
  })

  it('pins a span longer than its bounds to the bounds’ start', () => {
    expect(moveSpan({ start: 0, end: 12_000 }, 500, bounds)).toEqual({ start: 0, end: 12_000 })
  })
})

describe('stretchSpan', () => {
  it('stretches a span to at least its minimum', () => {
    expect(stretchSpan({ start: 2000, end: 3000 }, 'end', 2100, bounds, 200)).toEqual({ start: 2000, end: 2200 })
    expect(stretchSpan({ start: 2000, end: 3000 }, 'start', 2900, bounds, 200)).toEqual({ start: 2800, end: 3000 })
  })

  it('stays inside its bounds', () => {
    expect(stretchSpan({ start: 2000, end: 3000 }, 'end', 12_000, bounds, 200)).toEqual({ start: 2000, end: 10_000 })
    expect(stretchSpan({ start: 2000, end: 3000 }, 'start', -50, bounds, 200)).toEqual({ start: 0, end: 3000 })
  })
})
