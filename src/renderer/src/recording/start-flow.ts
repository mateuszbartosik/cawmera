import type { RecordingError } from '@shared/types'

export interface StartFlow {
  hideWindow(): Promise<void>
  restoreWindow(): Promise<void>
  startRecording(): Promise<RecordingError | null>
  beginRecording(): Promise<RecordingError | null>
  stopRecording(): Promise<void>
  /** The capture delay, 3 s at the shortest, so the helper has time to warm up. */
  countdown: { show(): Promise<void>; run(): Promise<boolean>; interrupt(): void; hide(): Promise<void> }
  showError(error: RecordingError): void
}

const internalError = (thrown: unknown): RecordingError => ({
  code: 'internal',
  message: thrown instanceof Error ? thrown.message : String(thrown)
})

/**
 * The helper warms up while the countdown runs. The countdown stays up until the helper is ready
 * and is gone before the take begins, so it never appears in the video.
 * Resolves true when the recording has begun; otherwise the window is back and nothing runs.
 */
export async function runStartFlow(flow: StartFlow): Promise<boolean> {
  const { countdown } = flow
  let helperRequested = false
  let helperStopped = false
  let countdownShown = false
  let began = false
  const start: { failure: RecordingError | null } = { failure: null }
  const stopHelper = async () => {
    helperStopped = true
    await flow.stopRecording()
  }
  const report = (error: RecordingError) => {
    if (error.code !== 'cancelled') flow.showError(error)
  }

  try {
    await flow.hideWindow()
    helperRequested = true
    const warmedUp = flow.startRecording().then(
      (error) => error,
      internalError
    )
    void warmedUp.then((error) => {
      if (!error) return
      start.failure = error
      countdown.interrupt()
    })

    countdownShown = true
    await countdown.show()
    const counted = await countdown.run()
    if (!counted && !start.failure) await stopHelper()
    await warmedUp
    countdownShown = false
    await countdown.hide()
    if (start.failure) {
      report(start.failure)
      return false
    }
    if (!counted) return false
    const beginError = await flow.beginRecording()
    if (beginError) {
      helperStopped = true
      report(beginError)
      return false
    }
    began = true
    return true
  } catch (thrown) {
    console.error('Recording failed', thrown)
    flow.showError(internalError(thrown))
    return false
  } finally {
    if (!began) {
      if (countdownShown) await countdown.hide().catch(() => {})
      if (helperRequested && !helperStopped && !start.failure) await flow.stopRecording().catch(() => {})
      await flow.restoreWindow()
    }
  }
}
