import { describe, expect, it } from 'vitest'
import { clampToTrim, hasReachedEnd, playbackStart } from '../src/renderer/src/recording/trim-loop'

const trim = { start: 1000, end: 9000 }

describe('trim loop', () => {
  it('plays on from where the playhead is inside the trim', () => {
    expect(playbackStart(4000, trim, false)).toBe(4000)
  })

  it('starts over from the trim start at or past the end, or before the start', () => {
    expect(playbackStart(9000, trim, false)).toBe(1000)
    expect(playbackStart(8970, trim, false)).toBe(1000)
    expect(playbackStart(200, trim, false)).toBe(1000)
  })

  it('starts over after the video ended on its own, even when it stopped short of the trim end', () => {
    expect(playbackStart(8700, trim, true)).toBe(1000)
  })

  it('pauses once the trim end is reached', () => {
    expect(hasReachedEnd(8999, trim)).toBe(false)
    expect(hasReachedEnd(9000, trim)).toBe(true)
    expect(hasReachedEnd(9500, trim)).toBe(true)
  })

  it('keeps seeks inside the trim', () => {
    expect(clampToTrim(500, trim)).toBe(1000)
    expect(clampToTrim(5000, trim)).toBe(5000)
    expect(clampToTrim(20_000, trim)).toBe(9000)
  })
})
