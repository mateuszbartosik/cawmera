import { describe, expect, it } from 'vitest'
import { dragSession } from '../src/renderer/src/timeline/drag-session'

describe('drag session', () => {
  it('commits one step however many times it is ended', () => {
    const committed: string[] = []
    const session = dragSession<string>((before) => committed.push(before))
    session.begin('before')
    expect(session.accepts(1)).toBe(true)
    session.end()
    session.end()
    expect(committed).toEqual(['before'])
  })

  it('commits when the edge leaves the view mid-drag, and later moves change nothing', () => {
    const committed: string[] = []
    const session = dragSession<string>((before) => committed.push(before))
    session.begin('before')
    session.end()
    expect(session.accepts(0)).toBe(false)
    expect(session.accepts(1)).toBe(false)
    expect(committed).toEqual(['before'])
  })

  it('ends on a move without a pressed button', () => {
    const committed: string[] = []
    const session = dragSession<string>((before) => committed.push(before))
    session.begin('before')
    expect(session.accepts(0)).toBe(false)
    expect(session.isOpen).toBe(false)
    expect(committed).toEqual(['before'])
  })
})
