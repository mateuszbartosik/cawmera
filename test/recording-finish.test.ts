import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ restoreWindow: vi.fn(async () => undefined) }))

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('../src/renderer/src/platform/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/src/platform/bridge')>()),
  bridge: { restoreWindow: mocks.restoreWindow }
}))

const { finishRecording } = await import('../src/renderer/src/recording/actions')
const { getRecording } = await import('../src/renderer/src/recording/registry')
const { isUnsaved, liveShots, store } = await import('../src/renderer/src/app/store')

function posterVideo() {
  const video = {
    currentTime: 0,
    onloadeddata: null as (() => void) | null,
    removeAttribute: vi.fn(),
    load: vi.fn()
  }
  const poster = { close: vi.fn() } as unknown as ImageBitmap
  vi.stubGlobal('document', { createElement: () => video })
  vi.stubGlobal('createImageBitmap', async () => poster)
  return { poster, loaded: () => video.onloadeddata?.() }
}

const trackJson = (cursor: number[][], clicks: number[][]) =>
  JSON.stringify({ version: 1, kind: 'monitor', width: 1920, height: 1080, fps: 60, durationMs: 4000, scale: 1, shapes: ['arrow'], cursor, clicks })

afterEach(() => {
  vi.unstubAllGlobals()
  mocks.restoreWindow.mockClear()
})

describe('finishing a take', () => {
  it('counts the new shot as unsaved the moment the take ends, before its poster is read', async () => {
    const video = posterVideo()
    const finished = finishRecording({ id: 'take-1', stoppedBy: 'shortcut', track: trackJson([[0, 500, 400, 0]], []) })

    expect(liveShots().filter(isUnsaved).map((record) => record.doc.sourceId)).toEqual(['take-1'])
    expect(getRecording('take-1')?.poster).toBeNull()

    video.loaded()
    await finished
    expect(getRecording('take-1')?.poster).toBe(video.poster)
    expect(store.get().capture.phase).toBe('idle')
    expect(mocks.restoreWindow).toHaveBeenCalledTimes(1)
  })

  it('leaves out the taskbar click that stopped the take, so the trim cuts the trip to the taskbar', async () => {
    const video = posterVideo()
    const restThenTrip = [[0, 500, 400, 0], [1000, 500, 400, 0], [2000, 500, 400, 0], [3000, 500, 400, 0], [3400, 700, 730, 0], [3800, 900, 1060, 0]]
    const clicks = [[1000, 500, 400, 0, 1090], [3800, 900, 1060, 0, -1]]
    const finished = finishRecording({ id: 'take-2', stoppedBy: 'window', track: trackJson(restThenTrip, clicks) })
    video.loaded()
    await finished
    expect(getRecording('take-2')?.track.clicks.map((click) => click.t)).toEqual([1000])
    expect(store.get().doc.recording?.trim).toEqual({ start: 0, end: 3000 })
  })
})
