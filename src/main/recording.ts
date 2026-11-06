import { app, globalShortcut, ipcMain, screen, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { release } from 'node:os'
import { join } from 'node:path'
import type { RecordingError, RecordingFinished, RecordingStartRequest, RecordingSupport } from '../shared/types'
import { startRecorder, type RecorderSession } from './recorder-process'
import { clearRecordings, isRecordingId, recordingDir, removeRecording } from './recording-files'

const STOP_SHORTCUT = 'CommandOrControl+Shift+2'
const MIN_WINDOWS_BUILD = 19041
const FRAMES_PER_SECOND = 60
const READY_TIMEOUT_MS = 10_000
const STOP_TIMEOUT_MS = 20_000

type StoppedBy = RecordingFinished['stoppedBy']

const recordingsRoot = () => join(app.getPath('temp'), 'Cawmera', 'recordings')

const helperPath = () =>
  app.isPackaged
    ? join(process.resourcesPath, 'cawmera-recorder.exe')
    : join(app.getAppPath(), 'native', 'recorder', 'build', 'Release', 'cawmera-recorder.exe')

function recordingSupport(): RecordingSupport {
  if (process.platform !== 'win32') return { ok: false, reason: 'platform' }
  const build = Number(release().split('.')[2])
  if (!(build >= MIN_WINDOWS_BUILD)) return { ok: false, reason: 'windows-version' }
  return existsSync(helperPath()) ? { ok: true } : { ok: false, reason: 'helper-missing' }
}

/** Only recordings that finished in this run are served, and the id never becomes a path from the request. */
const finishedIds = new Set<string>()

export const recordingVideoFile = (id: string) =>
  isRecordingId(id) && finishedIds.has(id) ? join(recordingDir(recordingsRoot(), id), 'video.mp4') : null

const failure = (code: RecordingError['code'], message: string): RecordingError => ({ code, message })

const asRecordingError = (error: unknown): RecordingError => {
  const candidate = error as Partial<RecordingError> | null
  if (candidate && typeof candidate.code === 'string' && typeof candidate.message === 'string') return candidate as RecordingError
  return failure('internal', error instanceof Error ? error.message : 'The recording could not start')
}

/** Window ids look like `window:<hwnd>:0`; screens are found through their Electron display. */
function targetArgs(request: RecordingStartRequest): string[] | null {
  const window = /^window:(\d+):\d+$/.exec(request.sourceId)
  if (window) return ['--window', window[1]]
  if (!request.sourceId.startsWith('screen:')) return null
  const display = screen.getAllDisplays().find((candidate) => String(candidate.id) === request.displayId)
  if (!display) return null
  const { x, y, width, height } = display.bounds
  const centre = screen.dipToScreenPoint({ x: x + width / 2, y: y + height / 2 })
  return ['--monitor-point', `${Math.round(centre.x)},${Math.round(centre.y)}`]
}

export function registerRecording(getWindow: () => BrowserWindow | null) {
  interface Take {
    id: string
    dir: string
    session: RecorderSession
    begun: boolean
    cancelled: boolean
    stopReason: StoppedBy | null
  }
  let take: Take | null = null
  /** Why the warmed-up helper ended before beginRecording() was called; reported by that call. */
  let endedBeforeBegin: RecordingError | null = null
  let starting: { abort: AbortController; done: Promise<unknown> } | null = null
  let detachTriggers = () => {}

  const send = (channel: string, payload: unknown) => getWindow()?.webContents.send(channel, payload)

  const requestStop = (reason: StoppedBy) => {
    if (take) {
      if (!take.begun) take.cancelled = true
      else take.stopReason ??= reason
      take.session.stop()
    } else {
      starting?.abort.abort()
    }
  }

  const attachTriggers = () => {
    const shortcutRegistered = globalShortcut.register(STOP_SHORTCUT, () => requestStop('shortcut'))
    const window = getWindow()
    const onRestore = () => requestStop('window')
    window?.on('restore', onRestore)
    detachTriggers = () => {
      if (shortcutRegistered) globalShortcut.unregister(STOP_SHORTCUT)
      window?.removeListener('restore', onRestore)
      detachTriggers = () => {}
    }
  }

  const conclude = async (current: Take) => {
    const result = await current.session.ended
    detachTriggers()
    if (take === current) take = null
    if (current.cancelled) {
      await removeRecording(recordingsRoot(), current.id).catch(() => {})
      return
    }
    if (!current.begun) {
      if ('error' in result) endedBeforeBegin = result.error
      return
    }
    if ('error' in result) {
      send('recording:failed', result.error)
      return
    }
    try {
      const track = await readFile(join(current.dir, 'track.json'), 'utf8')
      finishedIds.add(current.id)
      send('recording:finished', { id: current.id, stoppedBy: current.stopReason ?? 'target-gone', track } satisfies RecordingFinished)
    } catch {
      send('recording:failed', failure('internal', 'The recording finished but its cursor track could not be read'))
    }
  }

  const warmUp = async (request: RecordingStartRequest, abort: AbortSignal): Promise<RecordingError | null> => {
    const support = recordingSupport()
    if (!support.ok) return failure('unsupported', `Recording is not available (${support.reason})`)
    const target = targetArgs(request)
    if (!target) return failure('target-gone', 'The source to record is no longer available')
    const id = randomUUID()
    const dir = recordingDir(recordingsRoot(), id)
    try {
      await mkdir(dir, { recursive: true })
      const session = await startRecorder({
        command: helperPath(),
        args: [...target, '--fps', String(FRAMES_PER_SECOND), '--out', dir],
        readyTimeoutMs: READY_TIMEOUT_MS,
        stopTimeoutMs: STOP_TIMEOUT_MS,
        signal: abort
      })
      const current: Take = { id, dir, session, begun: false, cancelled: abort.aborted, stopReason: null }
      take = current
      void conclude(current)
      if (abort.aborted) {
        session.stop()
        return failure('cancelled', 'Recording cancelled')
      }
      return null
    } catch (error) {
      await removeRecording(recordingsRoot(), id).catch(() => {})
      return asRecordingError(error)
    }
  }

  ipcMain.handle('recording:support', () => recordingSupport())

  ipcMain.handle('recording:start', async (_event, request: unknown): Promise<RecordingError | null> => {
    const r = (request && typeof request === 'object' ? request : {}) as Partial<RecordingStartRequest>
    if (typeof r.sourceId !== 'string') return failure('internal', 'Invalid recording request')
    if (take || starting) return failure('internal', 'A recording is already running')
    endedBeforeBegin = null
    const abort = new AbortController()
    const done = warmUp({ sourceId: r.sourceId, displayId: typeof r.displayId === 'string' ? r.displayId : null }, abort.signal)
    starting = { abort, done }
    try {
      return await done
    } finally {
      starting = null
    }
  })

  ipcMain.handle('recording:begin', async (): Promise<RecordingError | null> => {
    const current = take
    if (!current || current.begun) {
      const early = endedBeforeBegin
      endedBeforeBegin = null
      return early ?? failure('internal', 'No recording is ready to begin')
    }
    current.session.begin()
    current.begun = true
    attachTriggers()
    return null
  })

  ipcMain.handle('recording:stop', () => requestStop('shortcut'))

  let cleanedUp = false
  app.on('will-quit', (event) => {
    if (cleanedUp) return
    event.preventDefault()
    cleanedUp = true
    void (async () => {
      requestStop('window')
      await starting?.done.catch(() => {})
      requestStop('window')
      if (take) await take.session.ended
      await clearRecordings(recordingsRoot()).catch(() => {})
      app.quit()
    })()
  })

  void clearRecordings(recordingsRoot()).catch(() => {})
}
