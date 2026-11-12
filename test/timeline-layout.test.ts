import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { store } from '../src/renderer/src/app/store'
import { TIMELINE_SPACE, timelineShows, workspaceGeometry } from '../src/renderer/src/canvas/view'
import { registerRecording } from '../src/renderer/src/recording/registry'
import { DEFAULT_RECORDING } from '../src/renderer/src/recording/settings'
import { wholeTake } from '../src/renderer/src/recording/timemap'

const recordingDoc = { ...DEFAULT_DOC, sourceId: 'rec', recording: { ...DEFAULT_RECORDING, trim: { start: 0, end: 1000 }, pieces: wholeTake(1000), zooms: null } }
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

describe('crop mode on a recording', () => {
  it('fits the video at the density it was captured at, above the timeline', () => {
    registerRecording({ id: 'rec', name: 'Take', poster: null, track: { kind: 'monitor', width: 2560, height: 1440, fps: 60, durationMs: 1000, scale: 2, cursor: [], clicks: [] } })
    const shown = show(recordingDoc, 1200)
    const screenshotLike = workspaceGeometry({ ...shown, mode: 'crop' })
    expect(screenshotLike.cropping).toBe(true)
    expect(screenshotLike.density).toBe(2)
    expect(screenshotLike.area.height).toBe(workspaceGeometry(shown).area.height - 46)
    expect(screenshotLike.k * 2560).toBeLessThanOrEqual(screenshotLike.area.width)
    expect(screenshotLike.k * 1440).toBeLessThanOrEqual(screenshotLike.area.height)
  })

  it('does not crop a recording whose take is unknown', () => {
    expect(workspaceGeometry({ ...show({ ...recordingDoc, sourceId: 'gone' }, 1200), mode: 'crop' }).cropping).toBe(false)
  })
})
