import type { AppState } from './store'

type Selections = Pick<AppState, 'selection' | 'timelineSelection' | 'shotSelection'> & Partial<Pick<AppState, 'mode'>>

export function escapeAction(s: Selections): 'clear-boxes' | 'clear-timeline' | 'clear-shots' | null {
  if (s.selection.length > 0) return 'clear-boxes'
  if (s.timelineSelection) return 'clear-timeline'
  if (s.shotSelection.length > 0) return 'clear-shots'
  return null
}

export function deleteAction(s: Selections): 'remove-boxes' | 'delete-zoom' | 'cut-range' | 'delete-shots' | null {
  if (s.selection.length > 0) return 'remove-boxes'
  if (s.timelineSelection && s.mode !== 'crop') return s.timelineSelection.kind === 'zoom' ? 'delete-zoom' : 'cut-range'
  if (s.shotSelection.length > 0) return 'delete-shots'
  return null
}
