import { describe, expect, it } from 'vitest'
import { DEFAULT_DOC, type Doc } from '../src/renderer/src/app/doc'
import { registerSource, store, updateDoc } from '../src/renderer/src/app/store'
import { DEFAULT_RECORDING } from '../src/renderer/src/recording/settings'
import { wholeTake } from '../src/renderer/src/recording/timemap'

const screenshot = (id: string) => ({
  id,
  bitmap: { close: () => undefined } as unknown as ImageBitmap,
  width: 100,
  height: 100,
  name: id,
  origin: 'paste' as const,
  detected: 1 as const
})

describe('undo history of a recording shot', () => {
  it('survives many screenshots being added', () => {
    const recorded: Doc = { ...DEFAULT_DOC, sourceId: 'take-1', recording: { ...DEFAULT_RECORDING, trim: { start: 0, end: 5000 }, pieces: wholeTake(5000), zooms: null } }
    store.set({ doc: recorded, past: [], future: [] })
    updateDoc({ recording: { ...DEFAULT_RECORDING, trim: { start: 0, end: 4000 }, pieces: wholeTake(5000), zooms: null } })
    for (let i = 0; i < 30; i++) registerSource(screenshot(`screenshot-${i}`))
    expect(store.get().past).toEqual([recorded])
  })
})
