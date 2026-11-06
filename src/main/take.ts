import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RecordingError, RecordingFinished, RecordingStartRequest, RecordingSupport } from '../shared/types'
import type { RecorderSession } from './recorder-process'
import { clearRecordings, isRecordingId, recordingDir, removeRecording } from './recording-files'

export const STOP_SHORTCUT = 'CommandOrControl+Shift+2'
const FRAMES_PER_SECOND = 60

type StoppedBy = RecordingFinished['stoppedBy']

export interface TakeWindow {
  isMinimized(): boolean
  on(event: 'restore', listener: () => void): unknown
  removeListener(event: 'restore', listener: () => void): unknown
  webContents: { send(channel: string, ...args: unknown[]): void }
}

export interface Shortcuts {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export interface TakeHost {
  recordingsRoot: string
  support(): RecordingSupport
  targetArgs(request: RecordingStartRequest): string[] | null
  /** Resolves once the helper is warm. Aborting before that rejects with a `cancelled` error. */
  startHelper(args: string[], signal: AbortSignal): Promise<RecorderSession>
  window(): TakeWindow | null
  shortcuts: Shortcuts
  beginDeadlineMs: number
}

interface Take {
  id: string
  dir: string
  abort: AbortController
  session: RecorderSession | null
  begun: boolean
  cancelled: boolean
  stopReason: StoppedBy | null
  beginDeadline?: NodeJS.Timeout
  detachers: (() => void)[]
  settled: Promise<void>
  settle: () => void
}

const failure = (code: RecordingError['code'], message: string): RecordingError => ({ code, message })

const cancelledError = () => failure('cancelled', 'Recording cancelled')

const asRecordingError = (error: unknown): RecordingError => {
  const candidate = error as Partial<RecordingError> | null
  if (candidate && typeof candidate.code === 'string' && typeof candidate.message === 'string') return candidate as RecordingError
  return failure('internal', error instanceof Error ? error.message : 'The recording could not start')
}

export function createTakeLifecycle(host: TakeHost) {
  let current: Take | null = null
  /** Why the last take ended before begin(); reported by that call. */
  let endedBeforeBegin: RecordingError | null = null
  /** Only takes that finished in this run are served, and the id never becomes a path from the request. */
  const finishedIds = new Set<string>()

  const send = (channel: string, ...payload: unknown[]) => host.window()?.webContents.send(channel, ...payload)

  const removeFiles = (take: Take) => removeRecording(host.recordingsRoot, take.id).catch(() => {})

  const consumeEndedBeforeBegin = () => {
    const error = endedBeforeBegin
    endedBeforeBegin = null
    return error
  }

  function newTake(): Take {
    const id = randomUUID()
    let settle = () => {}
    const settled = new Promise<void>((resolve) => (settle = resolve))
    return {
      id,
      dir: recordingDir(host.recordingsRoot, id),
      abort: new AbortController(),
      session: null,
      begun: false,
      cancelled: false,
      stopReason: null,
      detachers: [],
      settled,
      settle
    }
  }

  function release(take: Take) {
    clearTimeout(take.beginDeadline)
    for (const detach of take.detachers.splice(0)) detach()
    if (current === take) current = null
  }

  function cancel(take: Take) {
    if (take.begun || take.cancelled) return
    take.cancelled = true
    endedBeforeBegin = cancelledError()
    clearTimeout(take.beginDeadline)
    if (take.session) take.session.stop()
    else take.abort.abort()
  }

  function stopTake(take: Take, reason: StoppedBy) {
    if (!take.begun) return cancel(take)
    if (take.stopReason) return
    take.stopReason = reason
    take.session?.stop()
  }

  function watchRestore(take: Take) {
    const window = host.window()
    const onRestore = () => {
      if (take.begun) return stopTake(take, 'window')
      if (take.cancelled) return
      cancel(take)
      send('capture-cancel')
    }
    window?.on('restore', onRestore)
    return () => void window?.removeListener('restore', onRestore)
  }

  function registerStopShortcut(take: Take) {
    const registered = host.shortcuts.register(STOP_SHORTCUT, () => stopTake(take, 'shortcut'))
    return () => {
      if (registered) host.shortcuts.unregister(STOP_SHORTCUT)
    }
  }

  async function deliver(take: Take) {
    try {
      const track = await readFile(join(take.dir, 'track.json'), 'utf8')
      finishedIds.add(take.id)
      send('recording:finished', { id: take.id, stoppedBy: take.stopReason ?? 'target-gone', track } satisfies RecordingFinished)
    } catch {
      send('recording:failed', failure('internal', 'The recording finished but its cursor track could not be read'))
      await removeFiles(take)
    }
  }

  async function conclude(take: Take, session: RecorderSession) {
    const result = await session.ended
    if (!take.begun) {
      release(take)
      if (!take.cancelled && 'error' in result) endedBeforeBegin = result.error
      await removeFiles(take)
    } else if ('error' in result) {
      release(take)
      send('recording:failed', result.error)
      await removeFiles(take)
    } else {
      // Still current while its track is read, so a close in that moment is held instead of losing the take.
      await deliver(take)
      release(take)
    }
    take.settle()
  }

  async function start(request: RecordingStartRequest): Promise<RecordingError | null> {
    if (current) return failure('internal', 'A recording is already running')
    endedBeforeBegin = null
    const support = host.support()
    if (!support.ok) return { ...failure('unsupported', `Recording is not available (${support.reason})`), reason: support.reason }
    const target = host.targetArgs(request)
    if (!target) return failure('target-gone', 'The source to record is no longer available')
    const take = newTake()
    current = take
    take.detachers.push(watchRestore(take))
    let session: RecorderSession
    try {
      await mkdir(take.dir, { recursive: true })
      session = await host.startHelper([...target, '--fps', String(FRAMES_PER_SECOND), '--out', take.dir], take.abort.signal)
    } catch (error) {
      release(take)
      await removeFiles(take)
      take.settle()
      return asRecordingError(error)
    }
    take.session = session
    void conclude(take, session)
    if (take.cancelled) {
      session.stop()
      return cancelledError()
    }
    take.beginDeadline = setTimeout(() => cancel(take), host.beginDeadlineMs)
    return null
  }

  function begin(): RecordingError | null {
    const take = current
    if (!take?.session || take.begun || take.cancelled) {
      return consumeEndedBeforeBegin() ?? failure('internal', 'No recording is ready to begin')
    }
    if (!host.window()?.isMinimized()) {
      cancel(take)
      return consumeEndedBeforeBegin()
    }
    take.session.begin()
    take.begun = true
    clearTimeout(take.beginDeadline)
    take.detachers.push(registerStopShortcut(take))
    return null
  }

  function stop(reason: StoppedBy) {
    if (current) stopTake(current, reason)
  }

  function stopLiveTake() {
    if (!current?.begun) return false
    stopTake(current, 'window')
    return true
  }

  function cancelWarmTake() {
    if (current) cancel(current)
  }

  async function quit() {
    const take = current
    if (take) {
      stopTake(take, 'window')
      await take.settled
    }
    await clearRecordings(host.recordingsRoot).catch(() => {})
  }

  const videoFile = (id: string) =>
    isRecordingId(id) && finishedIds.has(id) ? join(recordingDir(host.recordingsRoot, id), 'video.mp4') : null

  return { start, begin, stop, stopLiveTake, cancelWarmTake, quit, videoFile }
}

export type TakeLifecycle = ReturnType<typeof createTakeLifecycle>
