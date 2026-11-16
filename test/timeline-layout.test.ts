import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { store, type AppState } from '../src/renderer/src/app/store'
import { deleteAction, escapeAction } from '../src/renderer/src/app/selection-keys'
import { floatingBarPlace, TIMELINE_SPACE, timelineEditable, timelineShows, workspaceGeometry } from '../src/renderer/src/canvas/view'
import { registerRecording } from '../src/renderer/src/recording/registry'
import { DEFAULT_RECORDING } from '../src/renderer/src/recording/settings'
import { wholeTake } from '../src/renderer/src/recording/timemap'
import { timelineSurface } from '../src/renderer/src/timeline/layout'

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

describe('the crop and selection bars', () => {
  it('float above the toolbar, lifted over the timeline when it shows, crop mode included', () => {
    expect(floatingBarPlace(show(screenshotDoc, 1200))).toEqual({ bottom: 58 })
    expect(floatingBarPlace(show(recordingDoc, 1200))).toEqual({ bottom: 58 + TIMELINE_SPACE })
    const cropping: AppState = { ...show(recordingDoc, 1200), mode: 'crop' }
    expect(floatingBarPlace(cropping)).toEqual({ bottom: 58 + TIMELINE_SPACE })
  })

  it('sit under the toolbar in the narrow layout, where no timeline shows', () => {
    expect(floatingBarPlace(show(recordingDoc, 700))).toEqual({ top: 56 })
    expect(floatingBarPlace(show(screenshotDoc, 700))).toEqual({ top: 56 })
  })

  it('give the same place object each time, so the bars can select it from the store', () => {
    const shown = show(recordingDoc, 1200)
    expect(floatingBarPlace(shown)).toBe(floatingBarPlace({ ...shown }))
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

describe('the timeline in crop mode', () => {
  it('is editable only on a recording in compose mode', () => {
    expect(timelineEditable({ ...show(recordingDoc, 1200), mode: 'compose' })).toBe(true)
    expect(timelineEditable({ ...show(recordingDoc, 1200), mode: 'crop' })).toBe(false)
    expect(timelineEditable({ ...show(screenshotDoc, 1200), mode: 'compose' })).toBe(false)
    expect(timelineEditable({ ...show(recordingDoc, 700), mode: 'compose' })).toBe(false)
  })

  it('leaves Delete without a timeline edit', () => {
    const selection: Pick<AppState, 'selection' | 'shotSelection' | 'timelineSelection'> = { selection: [], shotSelection: [], timelineSelection: { kind: 'range', start: 0, end: 500 } }
    expect(deleteAction({ ...selection, mode: 'compose' })).toBe('cut-range')
    expect(deleteAction({ ...selection, mode: 'crop' })).toBeNull()
    expect(deleteAction({ ...selection, timelineSelection: { kind: 'zoom', id: 'z' }, mode: 'crop' })).toBeNull()
    expect(escapeAction(selection)).toBe('clear-timeline')
  })
})

describe('the timeline surface', () => {
  it('never lets a drag select text, editable or not, and goes inert and dim while not editable', () => {
    expect(timelineSurface(true).split(' ')).toEqual(['select-none'])
    expect(timelineSurface(false).split(' ')).toEqual(['select-none', 'pointer-events-none', 'opacity-50'])
  })
})
