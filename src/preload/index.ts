import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from 'electron'
import type { CawmeraBridge, MenuCommand, RecordingError, RecordingFinished } from '../shared/types'

function subscribeWith<T>(channel: string, listener: (payload: T) => void) {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

function subscribe(channel: string, listener: () => void) {
  const handler = () => listener()
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const bridge: CawmeraBridge = {
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('app:version'),
  listCaptureSources: () => ipcRenderer.invoke('sources:list'),
  prepareCapture: (sourceId) => ipcRenderer.invoke('capture:prepare', sourceId),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  restoreWindow: () => ipcRenderer.invoke('window:restore'),
  setProgress: (value) => ipcRenderer.send('window:progress', value),
  showCountdown: (request) => ipcRenderer.invoke('countdown:show', request),
  tickCountdown: (remaining) => ipcRenderer.send('countdown:tick', remaining),
  hideCountdown: () => ipcRenderer.invoke('countdown:hide'),
  onCaptureCancel: (listener) => subscribe('capture-cancel', listener),
  saveImage: (bytes, suggestedName, format) => ipcRenderer.invoke('file:save-image', bytes, suggestedName, format),
  saveImages: (images) => ipcRenderer.invoke('file:save-images', images),
  copyPng: (bytes) => ipcRenderer.invoke('clipboard:write-png', bytes),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:read-image'),
  revealFile: (path) => ipcRenderer.invoke('file:reveal', path),
  recordingSupport: () => ipcRenderer.invoke('recording:support'),
  startRecording: (request) => ipcRenderer.invoke('recording:start', request),
  stopRecording: () => ipcRenderer.invoke('recording:stop'),
  onRecordingFinished: (listener) => subscribeWith<RecordingFinished>('recording:finished', listener),
  onRecordingFailed: (listener) => subscribeWith<RecordingError>('recording:failed', listener),
  saveVideo: (bytes, suggestedName) => ipcRenderer.invoke('file:save-video', bytes, suggestedName),
  setNativeTheme: (theme) => ipcRenderer.send('theme:set', theme),
  zoomFactor: () => webFrame.getZoomFactor(),
  onMenuCommand: (listener) => {
    const handler = (_event: IpcRendererEvent, command: MenuCommand) => listener(command)
    ipcRenderer.on('menu-command', handler)
    return () => {
      ipcRenderer.removeListener('menu-command', handler)
    }
  },
  onCloseRequest: (listener) => subscribe('close-request', listener),
  confirmDiscard: (unsavedCount) => ipcRenderer.invoke('window:confirm-discard', unsavedCount),
  closeWindow: () => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('cawmera', bridge)
