import { describe, expect, it } from 'vitest'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { autoTrim } from '../src/renderer/src/recording/trim'
import { DEFAULT_RECORDING, defaultsFor, differsFromDefault, recordingDocFor, type RecordingDoc } from '../src/renderer/src/recording/settings'
import { wholeTake } from '../src/renderer/src/recording/timemap'
import type { RecordingTrack } from '../src/renderer/src/recording/track'

const cursor = Array.from({ length: 100 }, (_, i) => ({ t: i * 16, x: i * 10, y: 400, shape: 'arrow' as const }))
const track: RecordingTrack = { kind: 'monitor', width: 1920, height: 1080, fps: 60, durationMs: 1600, scale: 1, cursor, clicks: [] }

describe('recording document', () => {
  it('gives a first recording the defaults, a fresh auto trim and the whole take as one uncut piece', () => {
    const doc = recordingDocFor(track, null)
    expect(doc).toEqual({ ...DEFAULT_RECORDING, trim: autoTrim(track), pieces: [{ start: 0, end: 1600, rate: 1, cut: false }] })
  })

  it('carries settings from the previous recording but not its trim or pieces', () => {
    const previous: RecordingDoc = {
      ...DEFAULT_RECORDING,
      cursorSize: 2,
      look: 'dark',
      trim: { start: 5, end: 6 },
      pieces: [{ start: 0, end: 3, rate: 4, cut: false }, { start: 3, end: 9, rate: 1, cut: true }]
    }
    const doc = recordingDocFor(track, previous)
    expect(doc.cursorSize).toBe(2)
    expect(doc.look).toBe('dark')
    expect(doc.trim).toEqual(autoTrim(track))
    expect(doc.pieces).toEqual(wholeTake(track.durationMs))
  })

  it('keeps screenshots free of recording settings', () => expect(DEFAULT_DOC.recording).toBeNull())

  it('tilts the cursor while it moves by default', () => expect(recordingDocFor(track, null).tilt).toBe(true))

  it('blurs the cursor and the camera at half a frame each by default, with no single motion blur', () => {
    const doc = recordingDocFor(track, null)
    expect(doc).toMatchObject({ cursorBlur: 0.5, cameraBlur: 0.5 })
    expect(doc).not.toHaveProperty('motionBlur')
  })
})

describe('section resets', () => {
  const doc = recordingDocFor(track, null)

  it('sees a section as customised only when one of its settings moved', () => {
    expect(differsFromDefault(doc, ['cursorSize', 'look'])).toBe(false)
    expect(differsFromDefault({ ...doc, look: 'dark' }, ['cursorSize', 'look'])).toBe(true)
    expect(differsFromDefault({ ...doc, look: 'dark' }, ['cursorBlur', 'cameraBlur'])).toBe(false)
    expect(differsFromDefault({ ...doc, cameraBlur: 0.8 }, ['cursorBlur', 'cameraBlur'])).toBe(true)
  })

  it('restores only the named settings', () => {
    const moved = { ...doc, look: 'dark' as const, cursorBlur: 0, cameraBlur: 1 }
    expect({ ...moved, ...defaultsFor(['look']) }).toEqual({ ...doc, cursorBlur: 0, cameraBlur: 1 })
    expect({ ...moved, ...defaultsFor(['cursorBlur', 'cameraBlur']) }).toEqual({ ...doc, look: 'dark' })
  })
})
