import { spawn } from 'node:child_process'
import type { RecordingError, RecordingErrorCode } from '../shared/types'

export type HelperEvent =
  | { type: 'ready'; width: number; height: number }
  | { type: 'done'; durationMs: number; frames: number }
  | { type: 'error'; code: RecordingErrorCode; message: string }

const isPositiveInteger = (value: unknown) => Number.isInteger(value) && (value as number) > 0

export function parseHelperLine(line: string): HelperEvent | null {
  try {
    const event = JSON.parse(line) as HelperEvent
    if (!event) return null
    if (event.type === 'ready') return isPositiveInteger(event.width) && isPositiveInteger(event.height) ? event : null
    if (event.type === 'done') return Number.isFinite(event.durationMs) && Number.isFinite(event.frames) ? event : null
    return event.type === 'error' ? event : null
  } catch {
    return null
  }
}

export type RecorderResult = { done: { durationMs: number; frames: number } } | { error: RecordingError }

export interface RecorderSession {
  width: number
  height: number
  ended: Promise<RecorderResult>
  /** Tells a warmed-up helper to start recording; its start time is t=0. */
  begin(): void
  /** Before begin() this cancels the take; the helper then ends with an internal error. */
  stop(): void
}

interface RecorderOptions {
  command: string
  args: string[]
  readyTimeoutMs: number
  stopTimeoutMs: number
  /** Aborting before ready kills the helper and rejects with a `cancelled` error. */
  signal?: AbortSignal
}

const MISSING_MEDIA_FEATURES = 0xc0000135

const internal = (message: string): RecordingError => ({ code: 'internal', message })

export function startRecorder(options: RecorderOptions): Promise<RecorderSession> {
  return new Promise((resolveStart, rejectStart) => {
    // stdin stays an open pipe for the whole session: its EOF would stop the helper.
    const child = spawn(options.command, options.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    child.stdin.on('error', () => {})
    child.stdout.setEncoding('utf8')

    let session: RecorderSession | null = null
    let finished = false
    let stopTimer: NodeJS.Timeout | null = null
    let endSession: (result: RecorderResult) => void = () => {}
    const ended = new Promise<RecorderResult>((resolve) => (endSession = resolve))

    const finish = (result: RecorderResult) => {
      if (finished) return
      finished = true
      clearTimeout(readyTimer)
      options.signal?.removeEventListener('abort', abort)
      if (stopTimer) clearTimeout(stopTimer)
      if (session) endSession(result)
      else rejectStart('error' in result ? result.error : internal('The recorder ended before it was ready'))
    }

    const readyTimer = setTimeout(() => {
      child.kill()
      finish({ error: { code: 'timeout', message: 'The recorder did not become ready in time' } })
    }, options.readyTimeoutMs)

    const abort = () => {
      if (session) return
      child.kill()
      finish({ error: { code: 'cancelled', message: 'Recording cancelled' } })
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()

    const handle = (event: HelperEvent) => {
      if (event.type === 'ready' && !session) {
        clearTimeout(readyTimer)
        session = {
          width: event.width,
          height: event.height,
          ended,
          begin: () => {
            if (!finished) child.stdin.write('{"type":"start"}\n')
          },
          stop: () => {
            if (stopTimer || finished) return
            child.stdin.write('{"type":"stop"}\n')
            stopTimer = setTimeout(() => {
              child.kill()
              finish({ error: { code: 'timeout', message: 'The recorder did not stop in time' } })
            }, options.stopTimeoutMs)
          }
        }
        resolveStart(session)
      } else if (event.type === 'done') {
        finish({ done: { durationMs: event.durationMs, frames: event.frames } })
      } else if (event.type === 'error') {
        finish({ error: { code: event.code, message: event.message } })
      }
    }

    let buffered = ''
    child.stdout.on('data', (chunk: string) => {
      buffered += chunk
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) {
        const event = parseHelperLine(line.trim())
        if (event) handle(event)
      }
    })

    child.on('error', (error) => finish({ error: internal(`The recorder could not start: ${error.message}`) }))
    // No terminal line: a crash, or Windows N without the Media Feature Pack failing before main runs.
    child.on('close', (code) => {
      const missingFeatures = !session || code === MISSING_MEDIA_FEATURES
      const hint = missingFeatures ? ' On Windows N, install the Media Feature Pack.' : ''
      finish({ error: internal(`The recorder exited unexpectedly (code ${code}).${hint}`) })
    })
  })
}
