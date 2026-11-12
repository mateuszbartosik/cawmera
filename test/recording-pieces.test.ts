import { describe, expect, it } from 'vitest'
import { cutRange, MIN_PIECE_MS, pieceAt, restoreRange, setRangeRate, splitAt, validPieces } from '../src/renderer/src/recording/pieces'
import { wholeTake, type Piece, type Rate } from '../src/renderer/src/recording/timemap'

const piece = (start: number, end: number, rate: Rate = 1, cut = false): Piece => ({ start, end, rate, cut })
const trim = { start: 0, end: 10_000 }

describe('pieces', () => {
  it('finds the piece holding a time, clamping outside the take', () => {
    const pieces = [piece(0, 4000), piece(4000, 10_000, 2)]
    expect(pieceAt(pieces, 4000)).toBe(pieces[1])
    expect(pieceAt(pieces, -5)).toBe(pieces[0])
    expect(pieceAt(pieces, 12_000)).toBe(pieces[1])
  })

  it('splits a piece at a time inside it, but not within 100 ms of an end', () => {
    expect(MIN_PIECE_MS).toBe(100)
    expect(splitAt(wholeTake(10_000), 4000)).toEqual([piece(0, 4000), piece(4000, 10_000)])
    expect(splitAt(wholeTake(10_000), 50)).toEqual(wholeTake(10_000))
    expect(splitAt(wholeTake(10_000), 9950)).toEqual(wholeTake(10_000))
  })

  it('cuts, restores and speeds up stretches, splitting at their ends', () => {
    const cut = cutRange(wholeTake(10_000), { start: 4000, end: 6000 }, trim)!
    expect(cut).toEqual([piece(0, 4000), piece(4000, 6000, 1, true), piece(6000, 10_000)])
    expect(restoreRange(cut, { start: 4000, end: 6000 })).toEqual([piece(0, 4000), piece(4000, 6000), piece(6000, 10_000)])
    expect(setRangeRate(wholeTake(10_000), { start: 2000, end: 6000 }, 4, trim)).toEqual([piece(0, 2000), piece(2000, 6000, 4), piece(6000, 10_000)])
  })

  it('never merges pieces, and keeps a cut flag while the rate changes', () => {
    const cut = cutRange(wholeTake(10_000), { start: 4000, end: 6000 }, trim)!
    expect(setRangeRate(cut, { start: 3000, end: 7000 }, 2, trim)).toEqual([
      piece(0, 3000),
      piece(3000, 4000, 2),
      piece(4000, 6000, 2, true),
      piece(6000, 7000, 2),
      piece(7000, 10_000)
    ])
  })

  it('takes a range end within 100 ms of a boundary to that boundary', () => {
    const split = splitAt(wholeTake(10_000), 6000)
    expect(cutRange(split, { start: 30, end: 5950 }, trim)).toEqual([piece(0, 6000, 1, true), piece(6000, 10_000)])
  })

  it('refuses a cut that would leave less than half a second', () => {
    expect(cutRange(wholeTake(10_000), { start: 0, end: 9600 }, trim)).toBeNull()
    expect(cutRange(wholeTake(10_000), { start: 0, end: 10_000 }, trim)).toBeNull()
  })

  it('counts output time, so a speed-up may not shrink the output under half a second either', () => {
    const second = { start: 0, end: 1000 }
    expect(setRangeRate(wholeTake(1000), { start: 0, end: 1000 }, 8, second)).toBeNull()
    expect(setRangeRate(wholeTake(1000), { start: 0, end: 1000 }, 2, second)).not.toBeNull()
  })

  it('lets a take that already plays less than the floor keep its length, but not shrink', () => {
    const short = { start: 0, end: 300 }
    expect(cutRange(wholeTake(300), { start: 0, end: 150 }, short)).toBeNull()
    expect(setRangeRate(wholeTake(300), { start: 0, end: 300 }, 1, short)).toEqual(wholeTake(300))
  })

  it('keeps pieces covering the whole take after any edits', () => {
    let pieces = wholeTake(10_000)
    for (const [start, end] of [[1000, 3000], [2500, 7000], [100, 9900]]) pieces = setRangeRate(pieces, { start, end }, 2, trim)!
    expect(pieces[0].start).toBe(0)
    expect(pieces.at(-1)!.end).toBe(10_000)
    pieces.forEach((p, i) => i && expect(p.start).toBe(pieces[i - 1].end))
  })
})

describe('validPieces', () => {
  it('leaves valid pieces alone', () => {
    const pieces = [piece(0, 4000), piece(4000, 6000, 4, true), piece(6000, 10_000)]
    expect(validPieces(pieces, 10_000)).toEqual(pieces)
  })

  it('orders pieces, closes gaps, trims overlaps and stretches the ends over the take', () => {
    expect(validPieces([piece(6000, 9000, 2), piece(500, 3000), piece(2500, 4000, 4, true)], 10_000)).toEqual([
      piece(0, 3000),
      piece(3000, 6000, 4, true),
      piece(6000, 10_000, 2)
    ])
  })

  it('clips to the take and drops pieces outside it or empty', () => {
    expect(validPieces([piece(-500, 4000), piece(4000, 4000), piece(4000, 20_000, 2), piece(15_000, 18_000)], 10_000)).toEqual([piece(0, 4000), piece(4000, 10_000, 2)])
  })

  it('repairs unknown rates and flags, and drops entries that are not pieces', () => {
    const input = [{ start: 0, end: 5000, rate: 3, cut: 'yes' }, null, 'x', { start: 'a', end: 1 }, { start: 5000, end: 10_000, rate: 8, cut: true }]
    expect(validPieces(input, 10_000)).toEqual([piece(0, 5000), piece(5000, 10_000, 8, true)])
  })

  it('falls back to one whole-take piece when nothing can be repaired', () => {
    expect(validPieces('nope', 10_000)).toEqual(wholeTake(10_000))
    expect(validPieces([], 10_000)).toEqual(wholeTake(10_000))
    expect(validPieces([piece(20_000, 30_000)], 10_000)).toEqual(wholeTake(10_000))
    expect(validPieces([piece(0, Number.NaN)], 10_000)).toEqual(wholeTake(10_000))
  })
})
