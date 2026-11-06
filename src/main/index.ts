import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  session,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { CaptureSource, CountdownRequest, ImageFormat, MenuCommand, NamedImage } from '../shared/types'
import { registerMediaProtocol, registerMediaScheme } from './media-protocol'
import { recordingVideoFile, registerRecording } from './recording'

registerMediaScheme()

let win: BrowserWindow | null = null
/** Set once the renderer agreed to close (no unsaved shots, or the user chose to discard them). */
let closeApproved = false
/** Closes anyway if the renderer never answers (crashed, reloading). */
let closeFallback: NodeJS.Timeout | null = null
const clearCloseFallback = () => {
  if (closeFallback) clearTimeout(closeFallback)
  closeFallback = null
}
/** Source id armed by the renderer right before it calls getDisplayMedia(). */
let armedSourceId: string | null = null
/** The on-screen countdown while a delayed capture waits. */
let overlay: BrowserWindow | null = null

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// Preferences (only the last export folder, so the next export lands next to the previous one)

interface Prefs {
  lastSaveDir?: string
}
const prefsPath = () => join(app.getPath('userData'), 'prefs.json')

async function readPrefs(): Promise<Prefs> {
  try {
    return JSON.parse(await readFile(prefsPath(), 'utf8')) as Prefs
  } catch {
    return {}
  }
}

async function writePrefs(prefs: Prefs) {
  await mkdir(dirname(prefsPath()), { recursive: true })
  await writeFile(prefsPath(), JSON.stringify(prefs, null, 2))
}

// ---------------------------------------------------------------------------
// Menu. Shortcuts are handled by the renderer (so they also work in the browser build);
// the menu only shows them and forwards clicks.

function send(command: MenuCommand) {
  win?.webContents.send('menu-command', command)
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const item = (label: string, accelerator: string, command: MenuCommand): MenuItemConstructorOptions => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: () => send(command)
  })
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        item('New shot', 'CmdOrCtrl+N', 'new-shot'),
        item('Open image…', 'CmdOrCtrl+O', 'open'),
        item('Capture…', 'CmdOrCtrl+Shift+2', 'capture'),
        { type: 'separator' },
        item('Copy image', 'CmdOrCtrl+Shift+C', 'copy'),
        item('Export…', 'CmdOrCtrl+S', 'export'),
        item('Export all…', 'CmdOrCtrl+Shift+S', 'export-all'),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        item('Undo', 'CmdOrCtrl+Z', 'undo'),
        item('Redo', 'CmdOrCtrl+Shift+Z', 'redo'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        item('Zoom to fit all', 'Shift+1', 'fit'),
        item('Zoom to shot', 'Shift+2', 'fit-shot'),
        item('Zoom to 100%', 'CmdOrCtrl+0', 'zoom-100'),
        item('Zoom in', 'CmdOrCtrl+=', 'zoom-in'),
        item('Zoom out', 'CmdOrCtrl+-', 'zoom-out'),
        { type: 'separator' },
        item('Previous shot', 'CmdOrCtrl+PageUp', 'previous-shot'),
        item('Next shot', 'CmdOrCtrl+PageDown', 'next-shot'),
        { type: 'separator' },
        item('Light / dark', 'CmdOrCtrl+Shift+L', 'toggle-theme'),
        item('House style', 'CmdOrCtrl+Alt+H', 'toggle-house-style'),
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    { role: 'help', submenu: [{ label: 'About Cawmera', click: () => send('about') }] }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------------------------------------------------------------------------
// Capture: the renderer picks a source in its own dialog, arms it here, then calls
// getDisplayMedia(). This handler hands that exact source to Chromium, so there is no system picker.

function registerDisplayMedia() {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      const id = armedSourceId
      armedSourceId = null
      if (!id) {
        callback({})
        return
      }
      // Ask only for the armed kind: when window enumeration fails, a combined query returns
      // nothing at all, and the capture would fail with "Invalid capture constraints".
      const type = id.startsWith('screen:') ? 'screen' : 'window'
      desktopCapturer
        .getSources({ types: [type], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const source = sources.find((candidate) => candidate.id === id)
          callback(source ? { video: source } : {})
        })
        .catch(() => callback({}))
    },
    { useSystemPicker: false }
  )
}

async function listSources(): Promise<CaptureSource[]> {
  const own = win?.getMediaSourceId()
  const thumbnailSize = { width: 480, height: 300 }
  // Screens and windows are listed separately: when window enumeration fails or times out,
  // a combined call returns nothing at all, and screens must stay available.
  const screens = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize }).catch(() => [])
  const windows = await desktopCapturer
    .getSources({ types: ['window'], thumbnailSize, fetchWindowIcons: true })
    .then((list) => list.filter((source) => !source.thumbnail.isEmpty())) // minimized windows can't be captured
    .catch(() => [])
  const sources = [...screens, ...windows]
  const displays = screen.getAllDisplays()
  const fallback = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()
  return sources
    .filter((source) => source.id !== own && source.name.trim() !== '')
    .map((source) => {
      const kind: CaptureSource['kind'] = source.id.startsWith('screen:') ? 'screen' : 'window'
      const display = kind === 'screen' ? displays.find((d) => String(d.id) === source.display_id) : undefined
      return {
        id: source.id,
        name: source.name,
        kind,
        thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
        appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
        scaleFactor: (display ?? fallback).scaleFactor,
        displayId: kind === 'screen' && source.display_id ? source.display_id : null
      }
    })
}

// ---------------------------------------------------------------------------
// Countdown: a small always-on-top bubble in the middle of the screen being captured (or the one
// under the pointer, for window captures). It never takes focus, so a menu opened during the delay
// stays open, and it is closed before the frame is read. Deliberately an ordinary small window:
// no full-screen click-through overlay and no capture exclusion, which security tools associate
// with screen-hiding malware.

const COUNTDOWN_SIZE = { width: 220, height: 230 }

function overlayDisplay(displayId: string | null): Electron.Display {
  const match = displayId ? screen.getAllDisplays().find((display) => String(display.id) === displayId) : undefined
  return match ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

function closeCountdown() {
  const current = overlay
  overlay = null
  if (current && !current.isDestroyed()) current.destroy()
}

async function showCountdown(request: CountdownRequest) {
  closeCountdown()
  const { bounds } = overlayDisplay(request.displayId)
  const seconds = Math.max(1, Math.min(60, Math.round(request.seconds)))
  const next = new BrowserWindow({
    x: Math.round(bounds.x + (bounds.width - COUNTDOWN_SIZE.width) / 2),
    y: Math.round(bounds.y + (bounds.height - COUNTDOWN_SIZE.height) / 2),
    ...COUNTDOWN_SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    title: 'Cawmera countdown',
    webPreferences: {
      preload: join(__dirname, '../preload/overlay.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  overlay = next
  next.setAlwaysOnTop(true, 'screen-saver')
  next.webContents.on('will-navigate', (event) => event.preventDefault())
  const color = typeof request.color === 'string' && /^#[0-9a-f]{6}$/i.test(request.color) ? request.color : '#FFFFFF'
  const query = { seconds: String(seconds), color }
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  try {
    if (!app.isPackaged && devUrl) await next.loadURL(`${devUrl}/overlay.html?${new URLSearchParams(query)}`)
    else await next.loadFile(join(__dirname, '../renderer/overlay.html'), { query })
  } catch {
    // A countdown that fails to load must not block the capture.
  }
  if (overlay === next && !next.isDestroyed()) next.showInactive()
}

// ---------------------------------------------------------------------------
// IPC

interface SaveDialogOptions {
  extension: string
  filter: Electron.FileFilter
  title: string
  defaultFolder: string
  fallbackName: string
}

/** Save dialog for one file, starting in the last export folder; null when cancelled or the payload is empty. */
async function saveBytesWithDialog(bytes: unknown, suggestedName: unknown, options: SaveDialogOptions) {
  if (!win || !(bytes instanceof Uint8Array) || bytes.byteLength === 0) return null
  const name = typeof suggestedName === 'string' && suggestedName.trim() ? basename(suggestedName.trim()) : options.fallbackName
  const prefs = await readPrefs()
  const folder = prefs.lastSaveDir && existsSync(prefs.lastSaveDir) ? prefs.lastSaveDir : options.defaultFolder
  const result = await dialog.showSaveDialog(win, {
    title: options.title,
    defaultPath: join(folder, name),
    filters: [options.filter],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (result.canceled || !result.filePath) return null
  const path =
    extname(result.filePath).toLowerCase() === `.${options.extension}` ? result.filePath : `${result.filePath}.${options.extension}`
  await writeFile(path, bytes)
  await writePrefs({ ...prefs, lastSaveDir: dirname(path) })
  return { path }
}

function registerIpc() {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('sources:list', () => listSources())

  ipcMain.handle('capture:prepare', (_event, id: unknown) => {
    if (typeof id !== 'string' || !/^(screen|window):/.test(id)) return false
    armedSourceId = id
    return true
  })

  ipcMain.handle('window:hide', async () => {
    if (!win) return
    if (process.platform === 'darwin') win.hide()
    else win.minimize()
    // Let the minimize animation finish and the screen repaint before anything is grabbed.
    await wait(process.platform === 'darwin' ? 600 : 450)
  })

  ipcMain.handle('window:restore', () => {
    if (!win) return
    win.setProgressBar(-1)
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  ipcMain.handle('countdown:show', (_event, request: unknown) => {
    const r = (request && typeof request === 'object' ? request : {}) as Partial<CountdownRequest>
    if (typeof r.seconds !== 'number' || !Number.isFinite(r.seconds)) return
    return showCountdown({
      displayId: typeof r.displayId === 'string' ? r.displayId : null,
      seconds: r.seconds,
      color: typeof r.color === 'string' ? r.color : undefined
    })
  })

  ipcMain.on('countdown:tick', (_event, remaining: unknown) => {
    if (overlay && !overlay.isDestroyed() && typeof remaining === 'number') overlay.webContents.send('countdown:tick', remaining)
  })

  ipcMain.handle('countdown:hide', async () => {
    const shown = overlay !== null
    closeCountdown()
    // Let the compositor drop it before any frame is read.
    if (shown) await wait(180)
  })

  ipcMain.on('overlay:cancel', (event) => {
    if (!overlay || event.sender !== overlay.webContents) return
    closeCountdown()
    win?.webContents.send('capture-cancel')
  })

  ipcMain.on('window:progress', (_event, value: unknown) => {
    if (win && typeof value === 'number' && Number.isFinite(value)) win.setProgressBar(value < 0 ? -1 : Math.min(1, value))
  })

  ipcMain.on('theme:set', (_event, theme: unknown) => {
    if (theme === 'dark' || theme === 'light') nativeTheme.themeSource = theme
  })

  const FILTERS: Record<ImageFormat, Electron.FileFilter> = {
    webp: { name: 'WebP image', extensions: ['webp'] },
    png: { name: 'PNG image', extensions: ['png'] }
  }

  ipcMain.handle('file:save-image', (_event, bytes: unknown, suggestedName: unknown, format: unknown) => {
    const kind: ImageFormat = format === 'png' ? 'png' : 'webp'
    return saveBytesWithDialog(bytes, suggestedName, {
      extension: kind,
      filter: FILTERS[kind],
      title: `Export ${kind.toUpperCase()}`,
      defaultFolder: app.getPath('pictures'),
      fallbackName: `whats-new-shot.${kind}`
    })
  })

  ipcMain.handle('file:save-video', (_event, bytes: unknown, suggestedName: unknown) =>
    saveBytesWithDialog(bytes, suggestedName, {
      extension: 'mp4',
      filter: { name: 'MP4 video', extensions: ['mp4'] },
      title: 'Export MP4',
      defaultFolder: app.getPath('videos'),
      fallbackName: 'whats-new-recording.mp4'
    })
  )

  ipcMain.handle('file:save-images', async (_event, images: unknown) => {
    if (!win || !Array.isArray(images) || images.length === 0) return null
    const valid = (images as NamedImage[]).filter((image) => typeof image?.name === 'string' && image.bytes instanceof Uint8Array)
    const prefs = await readPrefs()
    const folder = prefs.lastSaveDir && existsSync(prefs.lastSaveDir) ? prefs.lastSaveDir : app.getPath('pictures')
    const result = await dialog.showOpenDialog(win, {
      title: `Export ${valid.length} images to…`,
      defaultPath: folder,
      buttonLabel: 'Export here',
      properties: ['openDirectory', 'createDirectory']
    })
    const target = result.filePaths[0]
    if (result.canceled || !target) return null
    // Same names are allowed in the app; on disk the second one becomes name-2, and so on.
    const taken = new Set<string>()
    const paths: string[] = []
    for (const image of valid) {
      const ext = extname(image.name)
      const stem = basename(image.name, ext) || 'whats-new-shot'
      let candidate = `${stem}${ext}`
      for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`
      taken.add(candidate.toLowerCase())
      const path = join(target, candidate)
      await writeFile(path, image.bytes)
      paths.push(path)
    }
    await writePrefs({ ...prefs, lastSaveDir: target })
    return { folder: target, paths }
  })

  ipcMain.handle('window:confirm-discard', async (_event, count: unknown) => {
    clearCloseFallback()
    if (!win) return true
    const n = typeof count === 'number' ? count : 1
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Discard and close', 'Keep working'],
      defaultId: 1,
      cancelId: 1,
      message: n === 1 ? 'One shot hasn’t been exported.' : `${n} shots haven’t been exported.`,
      detail: 'Cawmera doesn’t keep screenshots after it closes.'
    })
    return response === 0
  })

  ipcMain.on('window:close', () => {
    clearCloseFallback()
    closeApproved = true
    win?.close()
  })

  ipcMain.handle('clipboard:write-png', async (_event, bytes: unknown) => {
    if (!(bytes instanceof Uint8Array)) throw new Error('Expected PNG bytes')
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(bytes)], { type: 'image/png' }) })])
  })

  ipcMain.handle('clipboard:read-image', async () => {
    for (const item of await clipboard.read()) {
      const type = item.types.find((candidate) => candidate.startsWith('image/'))
      if (!type) continue
      const blob = (await item.getType(type)) as Blob
      return new Uint8Array(await blob.arrayBuffer())
    }
    return null
  })

  ipcMain.handle('file:reveal', (_event, path: unknown) => {
    if (typeof path === 'string' && existsSync(path)) shell.showItemInFolder(path)
  })
}

// ---------------------------------------------------------------------------
// Window

function createWindow() {
  const devIcon = join(__dirname, '../../build/icon.png')
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Cawmera',
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    ...(!app.isPackaged && existsSync(devIcon) ? { icon: devIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // The capture countdown runs while the window is minimized; throttled timers stretched each
      // second to several.
      backgroundThrottling: false
    }
  })

  win.once('ready-to-show', () => win?.show())
  // Let the renderer check for unexported shots before the window goes away.
  win.on('close', (event) => {
    if (closeApproved || !win || win.webContents.isCrashed()) return
    event.preventDefault()
    win.webContents.send('close-request')
    clearCloseFallback()
    closeFallback = setTimeout(() => {
      closeApproved = true
      win?.close()
    }, 3000)
  })
  win.on('closed', () => {
    closeCountdown()
    win = null
    closeApproved = false
  })
  // Dropped files must never navigate the window away from the app.
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  // No spellchecking anywhere, so Chromium never fetches a dictionary from Google's CDN: Cawmera
  // makes no network requests at all. Done as each session is created, before any download starts.
  app.on('session-created', (created) => {
    created.setSpellCheckerEnabled(false)
    created.setSpellCheckerLanguages([])
  })

  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark'
    buildMenu()
    registerIpc()
    registerDisplayMedia()
    registerRecording(() => win)
    registerMediaProtocol(recordingVideoFile)
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
