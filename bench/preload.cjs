const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bench', {
  config: () => ipcRenderer.invoke('bench:config'),
  readCache: (name) => ipcRenderer.invoke('bench:read-cache', name),
  writeCache: (name, bytes) => ipcRenderer.invoke('bench:write-cache', name, bytes),
  progress: (message) => ipcRenderer.send('bench:progress', message),
  finish: (result) => ipcRenderer.invoke('bench:finish', result),
  fail: (message) => ipcRenderer.invoke('bench:fail', message)
})
