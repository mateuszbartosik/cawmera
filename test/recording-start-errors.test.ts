import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { CaptureSource } from '../src/shared/types'

const bridge = vi.hoisted(() => ({
  hideWindow: vi.fn(async () => {}),
  restoreWindow: vi.fn(async () => {}),
  startRecording: vi.fn(),
  beginRecording: vi.fn(),
  stopRecording: vi.fn(async () => {})
}))

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('../src/renderer/src/platform/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/src/platform/bridge')>()),
  bridge
}))

const { recordSource } = await import('../src/renderer/src/recording/actions')
const { store } = await import('../src/renderer/src/app/store')

const source: CaptureSource = { id: 'window:42:0', name: 'Notes', kind: 'window', thumbnail: '', appIcon: null, scaleFactor: 1, displayId: null }

beforeEach(() => {
  vi.clearAllMocks()
  store.set({ delay: 0, capture: { phase: 'idle', remaining: 0 } })
})

describe('a recording that cannot start', () => {
  it('says the recorder is missing instead of blaming the Windows version', async () => {
    bridge.startRecording.mockResolvedValue({ code: 'unsupported', message: 'Recording is not available (helper-missing)', reason: 'helper-missing' })
    await recordSource(source)
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('The recorder is missing from this build')
    expect(bridge.restoreWindow).toHaveBeenCalledTimes(1)
    expect(store.get().capture.phase).toBe('idle')
  })

  it('passes on what the recorder itself says is unsupported', async () => {
    bridge.startRecording.mockResolvedValue({ code: 'unsupported', message: 'Windows can’t capture the screen on this PC' })
    await recordSource(source)
    expect(toast.error).toHaveBeenCalledWith('Recording isn’t available', { description: 'Windows can’t capture the screen on this PC' })
  })
})
