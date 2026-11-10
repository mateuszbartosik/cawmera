import type { AppState } from './store'

type Selections = Pick<AppState, 'selection' | 'timelineSelection' | 'shotSelection'>

export function escapeAction(s: Selections): 'clear-boxes' | 'clear-timeline' | 'clear-shots' | null {
  if (s.selection.length > 0) return 'clear-boxes'
  if (s.timelineSelection) return 'clear-timeline'
  if (s.shotSelection.length > 0) return 'clear-shots'
  return null
}

/** 'ignore': a timeline selection is set, and deleting zooms and ranges arrives with the editing tasks. */
export function deleteAction(s: Selections): 'remove-boxes' | 'delete-shots' | 'ignore' | null {
  if (s.selection.length > 0) return 'remove-boxes'
  if (s.timelineSelection) return 'ignore'
  if (s.shotSelection.length > 0) return 'delete-shots'
  return null
}
