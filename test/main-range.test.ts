import { expect, it } from 'vitest'
import { parseRange } from '../src/main/range'

it('parses ranges', () => {
  expect(parseRange(null, 1000)).toBeNull()
  expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
  expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 })
  expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
  expect(parseRange('bytes=2000-', 1000)).toBe('unsatisfiable')
  expect(parseRange('items=0-1', 1000)).toBeNull()
})

it('clamps an end past the file and rejects reversed or empty ranges', () => {
  expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 })
  expect(parseRange('bytes=500-100', 1000)).toBe('unsatisfiable')
  expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable')
  expect(parseRange('bytes=0-1', 0)).toBe('unsatisfiable')
  expect(parseRange('bytes=abc', 1000)).toBeNull()
})
