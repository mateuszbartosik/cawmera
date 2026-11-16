import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureSource } from '../src/shared/types'

const mocks = vi.hoisted(() => {
  const calls: string[] = []
  const noting = (name: string) => vi.fn(async () => void calls.push(name))
  return {
    calls,
    bridge: {
      prepareCapture: vi.fn(async () => true),
      hideWindow: noting('hideWindow'),
      restoreWindow: noting('restoreWindow'),
      showCountdown: vi.fn(async ({ seconds }: { seconds: number }) => void calls.push(`showCountdown ${seconds}`)),
      tickCountdown: vi.fn((remaining: number) => void calls.push(`tick ${remaining}`)),
      setProgress: vi.fn(),
      hideCountdown: noting('hideCountdown')
    },
    grabFrame: vi.fn(async () => {
      calls.push('grabFrame')
      return { width: 800, height: 600, close: vi.fn() } as unknown as ImageBitmap
    })
  }
})

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('../src/renderer/src/platform/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/src/platform/bridge')>()),
  bridge: mocks.bridge,
  isDesktop: true,
  grabFrame: mocks.grabFrame,
  stopStream: vi.fn()
}))
vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn(async () => ({})) } })

const { captureSource } = await import('../src/renderer/src/app/actions')
const { CAPTURE_DELAYS, storedDelay, store } = await import('../src/renderer/src/app/store')
const { captureDelayNote, captureDialogTitle, screenshotButtonLabel } = await import('../src/renderer/src/panel/capture-labels')

const source: CaptureSource = { id: 'window:42:0', name: 'Notes', kind: 'window', thumbnail: '', appIcon: null, scaleFactor: 1, displayId: null }

describe('the capture delay', () => {
  it('offers 3, 5 and 10 s', () => {
    expect(CAPTURE_DELAYS).toEqual([3, 5, 10])
  })

  it('loads a stored 0, or anything it doesn’t know, as 3 s, which is also where it starts', () => {
    expect([0, undefined, null, 'off', 7, 3, 5, 10].map(storedDelay)).toEqual([3, 3, 3, 3, 3, 3, 5, 10])
  })
})

describe('a screenshot', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] })
    mocks.calls.length = 0
    store.set({ delay: 3, capture: { phase: 'idle', remaining: 0 } })
  })
  afterEach(() => vi.useRealTimers())

  it('always counts down the delay before the frame is read', async () => {
    const capturing = captureSource(source)
    await vi.advanceTimersByTimeAsync(3000)
    await capturing
    expect(mocks.calls).toEqual(['hideWindow', 'showCountdown 3', 'tick 3', 'tick 2', 'tick 1', 'hideCountdown', 'grabFrame', 'restoreWindow'])
  })
})

describe('the capture dialog', () => {
  it('names the mode it was opened with', () => {
    expect(captureDialogTitle('screenshot')).toBe('Screenshot')
    expect(captureDialogTitle('recording')).toBe('Record')
  })

  it('says how long after the pick it captures or starts', () => {
    expect(captureDelayNote('screenshot', 3)).toBe('Captures 3 s after you pick')
    expect(captureDelayNote('recording', 10)).toBe('Starts 10 s after you pick')
  })
})

describe('the Screenshot button', () => {
  it('reads Screenshot, and says what a capture is doing while one runs', () => {
    expect(screenshotButtonLabel({ phase: 'idle', remaining: 0 })).toBe('Screenshot')
    expect(screenshotButtonLabel({ phase: 'picking', remaining: 0 })).toBe('Picking…')
    expect(screenshotButtonLabel({ phase: 'countdown', remaining: 2 })).toBe('In 2…')
    expect(screenshotButtonLabel({ phase: 'grabbing', remaining: 0 })).toBe('Capturing…')
  })
})
