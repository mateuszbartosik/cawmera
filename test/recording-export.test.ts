import { describe, expect, it } from 'vitest'
import { exportFileName, slugify } from '../src/renderer/src/app/doc'
import { outputFrameTimes, outputToSource, timeMapOf, wholeTake } from '../src/renderer/src/recording/timemap'
import type { Trim } from '../src/renderer/src/recording/trim'

describe('export frame times', () => {
  const sourceFrameTimes = (trim: Trim, fps: number) => {
    const map = timeMapOf(trim, wholeTake(10_000))
    return outputFrameTimes(map, fps).map((outputMs) => outputToSource(map, outputMs))
  }

  it('steps through the trim at the frame rate', () => {
    expect(sourceFrameTimes({ start: 1000, end: 1100 }, 60).map(Math.round)).toEqual([1000, 1017, 1033, 1050, 1067, 1083])
    expect(sourceFrameTimes({ start: 0, end: 1000 }, 30)).toHaveLength(30)
  })

  it('exports at least one frame for a tiny trim', () => {
    expect(sourceFrameTimes({ start: 500, end: 501 }, 60)).toEqual([500])
  })

  it('exports one frame for an empty trim', () => {
    expect(sourceFrameTimes({ start: 500, end: 500 }, 60)).toEqual([500])
  })
})

describe('video file names', () => {
  it('names exports .mp4', () => {
    expect(exportFileName('Support contract.mp4', 'mp4', 'brave-otter-fig')).toBe('support-contract.mp4')
  })

  it('still strips image extensions', () => {
    expect(slugify('Shot.PNG')).toBe('shot')
    expect(slugify('Shot.webp')).toBe('shot')
  })
})
