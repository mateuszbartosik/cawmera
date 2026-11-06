import { app, globalShortcut, ipcMain, screen, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import type { RecordingError, RecordingStartRequest, RecordingSupport } from '../shared/types'
import { startRecorder } from './recorder-process'
import { clearRecordings } from './recording-files'
import { createTakeLifecycle, type TakeLifecycle } from './take'

const MIN_WINDOWS_BUILD = 19041
const READY_TIMEOUT_MS = 10_000
const STOP_TIMEOUT_MS = 20_000
const BEGIN_DEADLINE_MS = 60_000

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

let takes: TakeLifecycle | null = null

export const recordingVideoFile = (id: string) => takes?.videoFile(id) ?? null

export const stopLiveTake = () => takes?.stopLiveTake() ?? false

export const cancelWarmTake = () => takes?.cancelWarmTake()

export function registerRecording(getWindow: () => BrowserWindow | null) {
  const root = recordingsRoot()
  const lifecycle = createTakeLifecycle({
    recordingsRoot: root,
    support: recordingSupport,
    targetArgs,
    startHelper: (args, signal) =>
      startRecorder({ command: helperPath(), args, readyTimeoutMs: READY_TIMEOUT_MS, stopTimeoutMs: STOP_TIMEOUT_MS, signal }),
    window: getWindow,
    shortcuts: globalShortcut,
    beginDeadlineMs: BEGIN_DEADLINE_MS
  })
  takes = lifecycle

  ipcMain.handle('recording:support', () => recordingSupport())

  ipcMain.handle('recording:start', (_event, request: unknown) => {
    const r = (request && typeof request === 'object' ? request : {}) as Partial<RecordingStartRequest>
    if (typeof r.sourceId !== 'string') return { code: 'internal', message: 'Invalid recording request' } satisfies RecordingError
    return lifecycle.start({ sourceId: r.sourceId, displayId: typeof r.displayId === 'string' ? r.displayId : null })
  })

  ipcMain.handle('recording:begin', () => lifecycle.begin())

  ipcMain.handle('recording:stop', () => lifecycle.stop('shortcut'))

  let cleanedUp = false
  app.on('will-quit', (event) => {
    if (cleanedUp) return
    event.preventDefault()
    cleanedUp = true
    void lifecycle.quit().then(() => app.quit())
  })

  void clearRecordings(root).catch(() => {})
}
