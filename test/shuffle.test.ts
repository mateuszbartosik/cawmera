import { describe, expect, it } from 'vitest'
import { angleDistance, DEFAULT_DOC, edgeDirections, type Doc, type Edge } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { shuffledLook } from '../src/renderer/src/app/shuffle'
import type { Size } from '../src/renderer/src/render/geometry'

const style = DEFAULT_HOUSE_STYLE
/** Captured at 2×, so 1 source px is 1 export px. */
const big = { width: 2880, height: 1800 } // runs off a 1600 × 1000 image on both sides
const fits = { width: 1000, height: 600 } // fits inside with the inset all round
const wide = { width: 1450, height: 600 } // fits across with one inset, not with two

const framed = (patch: Partial<Doc> = {}): Doc => ({ ...DEFAULT_DOC, sourceId: 'shot', capturedAt: 2, ...patch })

/** mulberry32: the same sequence every run. */
function seeded(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function edgesFrom(doc: Doc, image: Size) {
  const random = seeded(1)
  const seen = new Set<Edge | null>()
  for (let i = 0; i < 300; i++) seen.add(shuffledLook(doc, image, style, random).edge)
  return [...seen].sort()
}

describe('shuffle: the frame', () => {
  it('keeps showing the same corner of a screenshot bigger than the frame', () => {
    expect(edgesFrom(framed(), big)).toEqual(['b', 'c', 'r'])
  })

  it('lets a screenshot that fits inside come in from any other edge', () => {
    expect(edgesFrom(framed(), fits)).toEqual(['b', 'bl', 'br', 'l', 'r', 't', 'tl', 'tr'])
  })

  it('never cuts a side that shows in full', () => {
    // Inside, this one would lose its right end; it keeps running off the left or the right.
    expect(edgesFrom(framed(), wide)).toEqual(['bl', 'br', 'l', 'tl', 'tr'])
  })

  it('keeps the end a screenshot coming in from the top left shows', () => {
    expect(edgesFrom(framed({ edge: 'tl' }), big)).toEqual(['tl'])
  })

  it('judges what fits against the image size', () => {
    // At 1200 × 630 this one is taller than the frame, so it keeps showing its top.
    expect(edgesFrom(framed({ size: { width: 1200, height: 630 } }), fits)).toEqual(['bl', 'br', 'c', 'l', 'r'])
  })
})

describe('shuffle: the light', () => {
  it('comes from the side the frame leaves open, at least 60° from where it was', () => {
    const random = seeded(7)
    for (let i = 0; i < 300; i++) {
      const look = shuffledLook(framed({ angle: 300 }), big, style, random)
      const { x, y } = edgeDirections(look.edge!)
      const rad = (look.angle * Math.PI) / 180
      // Light direction (sin, -cos) against the side the frame runs off: never towards it.
      expect(Math.sin(rad) * x - Math.cos(rad) * y).toBeLessThanOrEqual(1e-9)
      expect(angleDistance(look.angle, 300)).toBeGreaterThanOrEqual(60)
      expect(Number.isInteger(look.angle)).toBe(true)
    }
  })

  it('stays put when the background is an image, and only the frame moves', () => {
    const look = shuffledLook(framed({ fill: 'image', angle: 123 }), big, style, seeded(3))
    expect(look.angle).toBe(123)
    expect(['b', 'c', 'r']).toContain(look.edge)
  })

  it('is all that changes on a shot without a screenshot', () => {
    const look = shuffledLook({ ...DEFAULT_DOC, angle: 10 }, null, style, seeded(5))
    expect(look.edge).toBeNull()
    expect(angleDistance(look.angle, 10)).toBeGreaterThanOrEqual(60)
  })
})
