import { describe, expect, it } from 'vitest'
import { clampSide, presetFor, ratioLabel } from '../src/renderer/src/app/size'

describe('image size', () => {
  it('recognizes a preset by its width and height', () => {
    expect(presetFor({ width: 1200, height: 630 })?.name).toBe('Article (OG)')
    expect(presetFor({ width: 1600, height: 1000 })?.name).toBe('Default 16:10')
    expect(presetFor({ width: 1201, height: 630 })).toBeNull()
    expect(presetFor({ width: 630, height: 1200 })).toBeNull()
  })

  it('keeps a typed side whole and within 400–4000 px', () => {
    expect(clampSide(250, 1600)).toBe(400)
    expect(clampSide(5000, 1600)).toBe(4000)
    expect(clampSide(1199.6, 1600)).toBe(1200)
    expect(clampSide(Number.NaN, 1600)).toBe(1600)
  })

  it('names the shape the way people say it', () => {
    expect(ratioLabel({ width: 1600, height: 1000 })).toBe('16:10')
    expect(ratioLabel({ width: 1200, height: 630 })).toBe('1.91:1')
    expect(ratioLabel({ width: 1500, height: 1000 })).toBe('3:2')
    expect(ratioLabel({ width: 800, height: 2000 })).toBe('2:5')
    expect(ratioLabel({ width: 1234, height: 567 })).toBe('2.18:1')
    expect(ratioLabel({ width: 567, height: 1234 })).toBe('1:2.18')
  })
})
