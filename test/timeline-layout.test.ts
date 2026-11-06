import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { store } from '../src/renderer/src/app/store'
import { TIMELINE_SPACE, timelineShows, workspaceGeometry } from '../src/renderer/src/canvas/view'
import { DEFAULT_RECORDING } from '../src/renderer/src/recording/settings'

const recordingDoc = { ...DEFAULT_DOC, sourceId: 'rec', recording: { ...DEFAULT_RECORDING, trim: { start: 0, end: 1000 } } }
const screenshotDoc = { ...DEFAULT_DOC, sourceId: 'shot' }

function show(doc: typeof DEFAULT_DOC, width: number) {
  store.set({ doc, viewport: { width, height: 900 }, mode: 'compose' })
  return store.get()
}

describe('timeline space', () => {
  beforeEach(() => store.set({ mode: 'compose' }))

  it('shows for a recording on a wide window and takes its height from the canvas', () => {
    const withTimeline = show(recordingDoc, 1200)
    expect(timelineShows(withTimeline)).toBe(true)
    const heightWith = workspaceGeometry(withTimeline).area.height
    const heightWithout = workspaceGeometry(show(screenshotDoc, 1200)).area.height
    expect(heightWithout - heightWith).toBe(TIMELINE_SPACE)
  })

  it('stays away for a screenshot', () => {
    expect(timelineShows(show(screenshotDoc, 1200))).toBe(false)
  })

  it('stays away in the narrow layout and leaves the canvas height alone', () => {
    const narrowRecording = show(recordingDoc, 700)
    expect(timelineShows(narrowRecording)).toBe(false)
    const narrowScreenshot = workspaceGeometry(show(screenshotDoc, 700)).area.height
    expect(workspaceGeometry(narrowRecording).area.height).toBe(narrowScreenshot)
  })
})

describe('crop', () => {
  it('is not available for a recording shot', async () => {
    const { enterCrop } = await import('../src/renderer/src/app/actions')
    show(recordingDoc, 1200)
    enterCrop()
    expect(store.get().mode).toBe('compose')
  })
})
