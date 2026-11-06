import { toast } from 'sonner'
import { bridge } from '../platform/bridge'

/** Success toast for a finished save: the saved file's name with a way to find it, or the download's name. */
export function toastSaved(saved: { path: string | null }, downloadName: string, description: string) {
  const path = saved.path
  if (path && bridge) {
    toast.success(`Saved ${path.split(/[\\/]/).pop()}`, {
      description,
      action: { label: 'Show in folder', onClick: () => void bridge?.revealFile(path) }
    })
  } else {
    toast.success(`Downloaded ${downloadName}`, { description })
  }
}

export function toastExportFailed(error: unknown) {
  toast.error('Export failed', { description: error instanceof Error ? error.message : String(error) })
}
