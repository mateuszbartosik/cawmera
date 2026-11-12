import { app, dialog, ipcMain, type BrowserWindow, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createDraftRequests } from './draft-requests'
import { adoptTake, recordingsRoot, takeFolder } from './recording'

const FILTERS: Electron.FileFilter[] = [{ name: 'Cawmera draft', extensions: ['cawmera'] }]

const progressTo = (sender: WebContents) => (share: number) => {
  if (!sender.isDestroyed()) sender.send('draft:progress', share)
}

export function registerDrafts(getWindow: () => BrowserWindow | null) {
  const requests = createDraftRequests({
    recordingsRoot: recordingsRoot(),
    newId: randomUUID,
    takeFolder,
    adoptTake,
    async chooseSaveTarget(fileName) {
      const window = getWindow()
      if (!window) return null
      const result = await dialog.showSaveDialog(window, {
        title: 'Save draft',
        defaultPath: join(app.getPath('documents'), fileName),
        filters: FILTERS,
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })
      return result.canceled || !result.filePath ? null : result.filePath
    },
    async chooseDraft() {
      const window = getWindow()
      if (!window) return null
      const result = await dialog.showOpenDialog(window, {
        title: 'Open draft',
        defaultPath: app.getPath('documents'),
        filters: FILTERS,
        properties: ['openFile']
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
  })

  ipcMain.handle('draft:save', (event, files: unknown, suggestedName: unknown) => requests.save(files, suggestedName, progressTo(event.sender)))

  ipcMain.handle('draft:open', (event, path: unknown) => requests.open(path, progressTo(event.sender)))

  app.on('quit', () => requests.discardUnfinishedSave())
}
