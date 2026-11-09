import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDirectory = join(root, 'bench', '.cache')
const resultsDirectory = join(root, 'bench', 'results')
const SECONDS_PER_CLIP_SECOND_PER_RUN = 4
const FIXED_TIMEOUT_MS = 5 * 60 * 1000

const config = JSON.parse(process.argv.find((argument) => argument.startsWith('--bench-config='))?.slice('--bench-config='.length) ?? '{}')

const timeoutMs = FIXED_TIMEOUT_MS + 1000 * SECONDS_PER_CLIP_SECOND_PER_RUN * (config.seconds ?? 20) * ((config.runs ?? 3) + 2)

app.setPath('userData', join(cacheDirectory, 'profile'))
app.commandLine.appendSwitch('no-proxy-server')

function exitWith(code) {
  app.exit(code)
}

async function machineInfo() {
  const gpu = await app.getGPUInfo('basic').catch(() => null)
  const device = gpu?.gpuDevice?.find((entry) => entry.active) ?? gpu?.gpuDevice?.[0]
  return {
    cpu: os.cpus()[0]?.model.trim(),
    logicalCores: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 2 ** 30),
    os: `${os.type()} ${os.release()}`,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    gpu: device ? { vendorId: device.vendorId, deviceId: device.deviceId, driver: device.driverVersion, name: gpu?.auxAttributes?.glRenderer ?? null } : null,
    gpuFeatures: app.getGPUFeatureStatus(),
    onBatteryPower: powerMonitor.isOnBatteryPower()
  }
}

function cachePath(name) {
  return join(cacheDirectory, basename(name))
}

ipcMain.handle('bench:config', () => config)
ipcMain.handle('bench:read-cache', async (_event, name) => readFile(cachePath(name)).catch(() => null))
ipcMain.handle('bench:write-cache', async (_event, name, bytes) => {
  await mkdir(cacheDirectory, { recursive: true })
  await writeFile(cachePath(name), bytes)
})
ipcMain.on('bench:progress', (_event, message) => console.log(message))
ipcMain.handle('bench:finish', async (_event, result) => {
  const full = { ...result, machine: await machineInfo(), startedAt: new Date().toISOString() }
  await mkdir(resultsDirectory, { recursive: true })
  const file = join(resultsDirectory, `export-${full.startedAt.replace(/[:.]/g, '-')}.json`)
  await writeFile(file, JSON.stringify(full, null, 2))
  console.log(result.line)
  console.log(`result: ${file}`)
  if (full.machine.onBatteryPower) console.log('warning: the machine was on battery power; the numbers are not comparable to a plugged-in run')
  exitWith(0)
})
ipcMain.handle('bench:fail', (_event, message) => {
  console.error(`bench failed: ${message}`)
  exitWith(1)
})

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      preload: join(root, 'bench', 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error(`page: ${event.message}`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`bench failed: the page process ended (${details.reason})`)
    exitWith(1)
  })
  setTimeout(() => {
    console.error('bench failed: timed out')
    exitWith(2)
  }, timeoutMs).unref()
  window.webContents.on('did-fail-load', (_event, code, description) => {
    console.error(`bench failed: the page did not load (${code} ${description})`)
    exitWith(1)
  })
  await window.loadFile(join(root, 'out-bench', 'export.html')).catch((error) => {
    console.error(`bench failed: ${error.message}`)
    exitWith(1)
  })
})
