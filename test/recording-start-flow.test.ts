import { describe, expect, it, vi } from 'vitest'
import type { RecordingError } from '../src/shared/types'
import { recordingCountdownSeconds, runStartFlow, type StartFlow } from '../src/renderer/src/recording/start-flow'

const targetGone: RecordingError = { code: 'target-gone', message: 'gone' }
const accessDenied: RecordingError = { code: 'access-denied', message: 'denied' }
const cancelled: RecordingError = { code: 'cancelled', message: 'Recording cancelled' }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function setup(overrides: Partial<StartFlow> = {}, withCountdown = true) {
  const calls: string[] = []
  const note = (name: string) => () => {
    calls.push(name)
    return Promise.resolve()
  }
  const flow: StartFlow = {
    hideWindow: note('hideWindow'),
    restoreWindow: note('restoreWindow'),
    startRecording: () => {
      calls.push('startRecording')
      return Promise.resolve(null)
    },
    beginRecording: () => {
      calls.push('beginRecording')
      return Promise.resolve(null)
    },
    stopRecording: note('stopRecording'),
    countdown: withCountdown
      ? {
          show: note('showCountdown'),
          run: () => {
            calls.push('runCountdown')
            return Promise.resolve(true)
          },
          interrupt: () => calls.push('interrupt') && undefined,
          hide: note('hideCountdown')
        }
      : null,
    showError: vi.fn(),
    ...overrides
  }
  return { flow, calls }
}

const count = (calls: string[], name: string) => calls.filter((call) => call === name).length

describe('recording start flow', () => {
  it('begins after the countdown is hidden and leaves the window hidden', async () => {
    const { flow, calls } = setup()
    expect(await runStartFlow(flow)).toBe(true)
    expect(calls.indexOf('hideCountdown')).toBeLessThan(calls.indexOf('beginRecording'))
    expect(count(calls, 'restoreWindow')).toBe(0)
    expect(count(calls, 'stopRecording')).toBe(0)
    expect(flow.showError).not.toHaveBeenCalled()
  })

  it('begins at once when there is no delay', async () => {
    const { flow, calls } = setup({}, false)
    expect(await runStartFlow(flow)).toBe(true)
    expect(calls).toEqual(['hideWindow', 'startRecording', 'beginRecording'])
  })

  it('stops the helper, shows no error and restores once when the countdown is cancelled', async () => {
    const { flow, calls } = setup()
    flow.countdown!.run = () => Promise.resolve(false)
    expect(await runStartFlow(flow)).toBe(false)
    expect(count(calls, 'stopRecording')).toBe(1)
    expect(count(calls, 'restoreWindow')).toBe(1)
    expect(calls).not.toContain('beginRecording')
    expect(flow.showError).not.toHaveBeenCalled()
  })

  it('ignores the cancelled result the helper reports after a stop', async () => {
    const { flow, calls } = setup({
      startRecording: () => Promise.resolve({ code: 'cancelled', message: 'cancelled' })
    })
    flow.countdown!.run = () => Promise.resolve(false)
    await runStartFlow(flow)
    expect(flow.showError).not.toHaveBeenCalled()
    expect(count(calls, 'restoreWindow')).toBe(1)
  })

  it('ends the countdown, shows one error and restores once when the start fails during it', async () => {
    const failing = deferred<RecordingError | null>()
    const countdownEnded = deferred<boolean>()
    const { flow, calls } = setup({ startRecording: () => failing.promise })
    flow.countdown!.run = () => countdownEnded.promise
    flow.countdown!.interrupt = () => {
      calls.push('interrupt')
      countdownEnded.resolve(false)
    }
    const running = runStartFlow(flow)
    failing.resolve(accessDenied)
    expect(await running).toBe(false)
    expect(calls).toContain('interrupt')
    expect(count(calls, 'stopRecording')).toBe(0)
    expect(flow.showError).toHaveBeenCalledTimes(1)
    expect(flow.showError).toHaveBeenCalledWith(accessDenied)
    expect(count(calls, 'restoreWindow')).toBe(1)
  })

  it('keeps the countdown up until a slow warm-up resolves, then hides it before beginning', async () => {
    const warm = deferred<RecordingError | null>()
    const { flow, calls } = setup({ startRecording: () => warm.promise })
    const running = runStartFlow(flow)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls).toContain('runCountdown')
    expect(calls).not.toContain('hideCountdown')
    expect(calls).not.toContain('beginRecording')
    warm.resolve(null)
    expect(await running).toBe(true)
    expect(calls.indexOf('hideCountdown')).toBeLessThan(calls.indexOf('beginRecording'))
  })

  it('ends the countdown at once and quietly when the take is cancelled during it', async () => {
    const warm = deferred<RecordingError | null>()
    const countdownEnded = deferred<boolean>()
    const { flow, calls } = setup({ startRecording: () => warm.promise })
    flow.countdown!.run = () => countdownEnded.promise
    flow.countdown!.interrupt = () => {
      calls.push('interrupt')
      countdownEnded.resolve(false)
    }
    const running = runStartFlow(flow)
    warm.resolve(cancelled)
    expect(await running).toBe(false)
    expect(calls).toContain('interrupt')
    expect(calls).not.toContain('beginRecording')
    expect(count(calls, 'stopRecording')).toBe(0)
    expect(flow.showError).not.toHaveBeenCalled()
    expect(count(calls, 'restoreWindow')).toBe(1)
  })

  it('restores quietly when beginning is cancelled because Cawmera is back on screen', async () => {
    const { flow, calls } = setup({ beginRecording: () => Promise.resolve(cancelled) })
    expect(await runStartFlow(flow)).toBe(false)
    expect(flow.showError).not.toHaveBeenCalled()
    expect(count(calls, 'stopRecording')).toBe(0)
    expect(count(calls, 'restoreWindow')).toBe(1)
  })

  it('shows one error and restores once when beginning fails', async () => {
    const { flow, calls } = setup({ beginRecording: () => Promise.resolve(targetGone) })
    expect(await runStartFlow(flow)).toBe(false)
    expect(flow.showError).toHaveBeenCalledTimes(1)
    expect(flow.showError).toHaveBeenCalledWith(targetGone)
    expect(count(calls, 'restoreWindow')).toBe(1)
  })

  it('stops the warm helper once when something throws after the start', async () => {
    const { flow, calls } = setup()
    flow.countdown!.show = () => Promise.reject(new Error('overlay failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await runStartFlow(flow)).toBe(false)
    expect(count(calls, 'stopRecording')).toBe(1)
    expect(count(calls, 'restoreWindow')).toBe(1)
    expect(flow.showError).toHaveBeenCalledTimes(1)
  })

  it('reports a start call that rejects without an unhandled rejection', async () => {
    const { flow, calls } = setup({ startRecording: () => Promise.reject(new Error('ipc closed')) })
    expect(await runStartFlow(flow)).toBe(false)
    expect(flow.showError).toHaveBeenCalledWith({ code: 'internal', message: 'ipc closed' })
    expect(count(calls, 'restoreWindow')).toBe(1)
  })
})

describe('the recording countdown length', () => {
  it('always counts down at least 3 s before a recording', () => {
    expect([0, 3, 5, 10].map(recordingCountdownSeconds)).toEqual([3, 3, 5, 10])
  })
})
