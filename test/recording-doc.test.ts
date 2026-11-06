import { describe, expect, it } from 'vitest'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { autoTrim } from '../src/renderer/src/recording/trim'
import { DEFAULT_RECORDING, recordingDocFor } from '../src/renderer/src/recording/settings'
import type { RecordingTrack } from '../src/renderer/src/recording/track'

const cursor = Array.from({ length: 100 }, (_, i) => ({ t: i * 16, x: i * 10, y: 400, shape: 'arrow' as const }))
const track: RecordingTrack = { kind: 'monitor', width: 1920, height: 1080, fps: 60, durationMs: 1600, scale: 1, cursor, clicks: [] }

describe('recording document', () => {
  it('gives a first recording the defaults and a fresh auto trim', () => {
    const doc = recordingDocFor(track, null)
    expect(doc).toEqual({ ...DEFAULT_RECORDING, trim: autoTrim(track) })
  })

  it('carries settings from the previous recording but not its trim', () => {
    const previous = { ...DEFAULT_RECORDING, cursorSize: 2, look: 'dark' as const, trim: { start: 5, end: 6 } }
    const doc = recordingDocFor(track, previous)
    expect(doc.cursorSize).toBe(2)
    expect(doc.look).toBe('dark')
    expect(doc.trim).toEqual(autoTrim(track))
  })

  it('keeps screenshots free of recording settings', () => expect(DEFAULT_DOC.recording).toBeNull())
})
