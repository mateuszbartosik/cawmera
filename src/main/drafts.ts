import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { basename, extname, isAbsolute, join } from 'node:path'
import type { DraftOpenResult } from '../shared/types'
import { DraftFileError, draftParts, readDraft, writeDraft } from './draft-file'
import { adoptTake, recordingsRoot, takeFolder } from './recording'

const EXTENSION = '.cawmera'
const FILTERS: Electron.FileFilter[] = [{ name: 'Cawmera draft', extensions: ['cawmera'] }]

const hasExtension = (path: string) => extname(path).toLowerCase() === EXTENSION
const withExtension = (path: string) => (hasExtension(path) ? path : `${path}${EXTENSION}`)
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function registerDrafts(getWindow: () => BrowserWindow | null) {
  const sendProgress = (share: number) => getWindow()?.webContents.send('draft:progress', share)

  async function chooseTarget(window: BrowserWindow, suggestedName: unknown) {
    const name = typeof suggestedName === 'string' && suggestedName.trim() ? basename(suggestedName.trim()) : 'whats-new-draft'
    const result = await dialog.showSaveDialog(window, {
      title: 'Save draft',
      defaultPath: join(app.getPath('documents'), withExtension(name)),
      filters: FILTERS,
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    return result.canceled || !result.filePath ? null : withExtension(result.filePath)
  }

  async function chooseDraft(window: BrowserWindow) {
    const result = await dialog.showOpenDialog(window, {
      title: 'Open draft',
      defaultPath: app.getPath('documents'),
      filters: FILTERS,
      properties: ['openFile']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }

  ipcMain.handle('draft:save', async (_event, files: unknown, suggestedName: unknown) => {
    const window = getWindow()
    if (!window) return null
    try {
      const parts = draftParts(files, takeFolder)
      const target = await chooseTarget(window, suggestedName)
      if (!target) return null
      await writeDraft(target, parts, sendProgress)
      return { path: target }
    } catch (error) {
      return { error: messageOf(error) }
    }
  })

  ipcMain.handle('draft:open', async (_event, requested: unknown): Promise<DraftOpenResult | null> => {
    const window = getWindow()
    if (!window) return null
    try {
      const path = requested === null ? await chooseDraft(window) : requested
      if (path === null) return null
      if (typeof path !== 'string' || !isAbsolute(path) || !hasExtension(path)) {
        return { ok: false, reason: 'not-a-draft', message: 'Not a .cawmera file' }
      }
      const files = await readDraft(path, recordingsRoot(), randomUUID, sendProgress)
      for (const { id } of files.recordings) adoptTake(id)
      return { ok: true, files }
    } catch (error) {
      const failure = error instanceof DraftFileError ? error : new DraftFileError('unreadable', messageOf(error))
      return { ok: false, reason: failure.reason, message: failure.message }
    }
  })
}
