import { Trash, X } from '@phosphor-icons/react'
import { deletePickedShots } from '../app/actions'
import { clearPickedShots, useApp } from '../app/store'
import { Button, IconButton } from '../ui/controls'
import { isNarrow, workspaceGeometry } from './view'

/** Floating bar above the toolbar while shots are picked on the canvas: how many, and Delete. */
export function SelectionBar() {
  const count = useApp((s) => (s.mode === 'compose' ? s.shotSelection.length : 0))
  const narrow = useApp((s) => isNarrow(s))
  const center = useApp((s) => {
    const g = workspaceGeometry(s)
    return g.area.x + g.area.width / 2
  })
  if (count === 0) return null
  return (
    <div
      role="toolbar"
      aria-label="Selected shots"
      data-testid="selection-bar"
      className="absolute flex h-10 -translate-x-1/2 items-center gap-1 rounded-lg border border-(--tc-line) bg-(--tc-panel) p-1 pl-3 text-(--tc-fg) shadow-[var(--tc-panel-shadow)] backdrop-blur-[40px] backdrop-saturate-150"
      style={narrow ? { left: center, top: 56 } : { left: center, bottom: 58 }}
    >
      <span className="mr-1.5 text-[12px] whitespace-nowrap text-(--tc-label) tabular-nums" data-testid="selection-count">
        {count === 1 ? '1 shot selected' : `${count} shots selected`}
      </span>
      <Button icon={<Trash size={14} />} onClick={deletePickedShots} data-testid="delete-shots" hint="Delete the selected shots (Delete)">
        Delete
      </Button>
      <IconButton label="Clear selection" shortcut="Esc" onClick={clearPickedShots} data-testid="clear-selection">
        <X size={13} />
      </IconButton>
    </div>
  )
}
