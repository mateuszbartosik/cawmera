import { describe, expect, it } from 'vitest'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { registerRecording, zoomsFor, type RecordingEntry } from '../src/renderer/src/recording/registry'
import { recordingScene } from '../src/renderer/src/recording/scene'
import { DEFAULT_RECORDING } from '../src/renderer/src/recording/settings'
import { autoZooms } from '../src/renderer/src/recording/zooms'

const frame = { width: 1920, height: 1080 }
const clicks = [
  { t: 3000, x: 500, y: 300, button: 'left' as const, up: 3080 },
  { t: 7000, x: 1400, y: 800, button: 'left' as const, up: 7080 }
]
const entry: RecordingEntry = {
  id: 'take-zooms',
  name: 'Recording',
  track: { kind: 'monitor', ...frame, fps: 60, durationMs: 12_000, scale: 1, cursor: [], clicks },
  poster: null
}

describe('zooms of a recording', () => {
  it('are computed once per trim and zoom speed', () => {
    registerRecording(entry)
    const trim = { start: 0, end: 12_000 }
    const zooms = zoomsFor(entry, trim, 'calm')
    expect(zooms).toEqual(autoZooms(clicks, frame, trim, 'calm'))
    expect(zoomsFor(entry, { ...trim }, 'calm')).toBe(zooms)
    expect(zoomsFor(entry, { start: 0, end: 9000 }, 'calm')).toEqual(autoZooms(clicks, frame, { start: 0, end: 9000 }, 'calm'))
    expect(zoomsFor(entry, { start: 0, end: 9000 }, 'quick')).toEqual(autoZooms(clicks, frame, { start: 0, end: 9000 }, 'quick'))
  })

  it('are the ones the preview and the export draw', () => {
    registerRecording(entry)
    const settings = { ...DEFAULT_RECORDING, zoomSpeed: 'quick' as const, trim: { start: 1000, end: 11_000 } }
    const doc = { ...DEFAULT_DOC, sourceId: entry.id, recording: settings }
    const scene = recordingScene(entry, doc, DEFAULT_HOUSE_STYLE, null, { tag: 'video' } as unknown as CanvasImageSource)
    expect(scene!.zooms).toBe(zoomsFor(entry, settings.trim, settings.zoomSpeed))
  })
})
