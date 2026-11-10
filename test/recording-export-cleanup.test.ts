import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { DEFAULT_RECORDING } from '../src/renderer/src/recording/settings'
import { timeMapOf, wholeTake } from '../src/renderer/src/recording/timemap'

const decoder = vi.hoisted(() => ({ returned: vi.fn(async () => ({ done: true, value: undefined })), picture: null as unknown }))

vi.mock('mediabunny', () => {
  class Output {
    addVideoTrack() {}
    async start() {}
    async cancel() {}
    async finalize() {}
  }
  return {
    ALL_FORMATS: [],
    UrlSource: class {},
    BufferTarget: class { buffer = new ArrayBuffer(0) },
    Mp4OutputFormat: class {},
    Quality: class {},
    CanvasSource: class { async add() {} },
    Output,
    Input: class {
      async getPrimaryVideoTrack() { return { getFirstTimestamp: async () => 0 } }
      dispose() {}
    },
    VideoSampleSink: class {
      samplesAtTimestamps() {
        return {
          [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false, value: decoder.picture }), return: decoder.returned })
        }
      }
    }
  }
})

vi.mock('../src/renderer/src/recording/scene', () => ({
  recordingScene: () => ({ view: { map: timeMapOf({ start: 0, end: 100 }, wholeTake(1000)) } })
}))

vi.mock('../src/renderer/src/recording/frame', () => ({
  drawRecordingFrame: () => { throw new Error('The draw failed.') }
}))

describe('an export that fails midway', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['a draw that throws', { toCanvasImageSource: () => ({}), close: () => undefined }, 'The draw failed.'],
    ['a missing picture', null, 'The recording has no picture at this point.']
  ])('closes the decoder after %s', async (_name, picture, message) => {
    decoder.picture = picture
    vi.stubGlobal('OffscreenCanvas', class { getContext() { return {} } })
    const { exportRecordingVideo } = await import('../src/renderer/src/recording/export')
    const entry = { id: 'x', name: 'x', poster: null, track: { width: 10, height: 10 } } as never
    const doc = { ...DEFAULT_DOC, recording: { ...DEFAULT_RECORDING, trim: { start: 0, end: 100 }, pieces: wholeTake(1000) } }
    await expect(exportRecordingVideo(entry, doc, DEFAULT_HOUSE_STYLE, null, () => undefined)).rejects.toThrow(message)
    expect(decoder.returned).toHaveBeenCalled()
  })
})
