import { toast } from 'sonner'
import { bridge } from '../platform/bridge'

/** A saved file's name, and the toast action that shows it in its folder. */
export function savedFile(path: string) {
  return {
    name: path.split(/[\\/]/).pop() ?? path,
    showInFolder: { label: 'Show in folder', onClick: () => void bridge?.revealFile(path) }
  }
}

/** Success toast for a finished save: the saved file's name with a way to find it, or the download's name. */
export function toastSaved(saved: { path: string | null }, downloadName: string, description: string) {
  const path = saved.path
  if (path && bridge) {
    const file = savedFile(path)
    toast.success(`Saved ${file.name}`, { description, action: file.showInFolder })
  } else {
    toast.success(`Downloaded ${downloadName}`, { description })
  }
}

export function toastExportFailed(error: unknown) {
  toast.error('Export failed', { description: error instanceof Error ? error.message : String(error) })
}
