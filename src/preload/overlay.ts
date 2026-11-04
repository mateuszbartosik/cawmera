import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

/** The on-screen countdown window: it only hears ticks and can ask to cancel. */
contextBridge.exposeInMainWorld('countdown', {
  onTick: (listener: (remaining: number) => void) => {
    ipcRenderer.on('countdown:tick', (_event: IpcRendererEvent, remaining: unknown) => {
      if (typeof remaining === 'number') listener(remaining)
    })
  },
  cancel: () => ipcRenderer.send('overlay:cancel')
})
