import { ArrowUUpLeft, ArrowUUpRight, CornersIn, MagnifyingGlassMinus, MagnifyingGlassPlus, Moon, Plus, Sun } from '@phosphor-icons/react'
import { newShot } from '../app/actions'
import { redo, store, undo, useApp } from '../app/store'
import { isNarrow, workspaceGeometry, zoomFit, zoomStep, zoomTo } from '../canvas/view'
import { IconButton } from '../ui/controls'

const Divider = () => <span className="mx-1 h-4 w-px bg-(--tc-line)" aria-hidden />

/** Floating bottom toolbar: new shot, history, view zoom, theme. */
export function Toolbar() {
  const canUndo = useApp((s) => s.past.length > 0)
  const canRedo = useApp((s) => s.future.length > 0)
  const theme = useApp((s) => s.theme)
  const zoom = useApp((s) => workspaceGeometry(s).zoom)
  const narrow = useApp((s) => isNarrow(s))
  const cropping = useApp((s) => s.mode === 'crop' && s.doc.sourceId !== null)
  const center = useApp((s) => {
    const g = workspaceGeometry(s)
    return g.area.x + g.area.width / 2
  })

  return (
    <div
      role="toolbar"
      aria-label="View"
      data-testid="toolbar"
      className="absolute flex h-9 -translate-x-1/2 items-center gap-0.5 rounded-lg border border-(--tc-line) bg-(--tc-panel) px-1.5 text-(--tc-fg) shadow-[var(--tc-panel-shadow)] backdrop-blur-[40px] backdrop-saturate-150"
      style={narrow ? { left: center, top: 10 } : { left: center, bottom: 12 }}
    >
      {!cropping && (
        <>
          <IconButton label="New shot" shortcut="Ctrl+N" onClick={newShot} data-testid="new-shot">
            <Plus size={15} />
          </IconButton>
          <Divider />
        </>
      )}
      <IconButton label="Undo" shortcut="Ctrl+Z" onClick={undo} disabled={!canUndo}>
        <ArrowUUpLeft size={15} />
      </IconButton>
      <IconButton label="Redo" shortcut="Ctrl+Shift+Z" onClick={redo} disabled={!canRedo}>
        <ArrowUUpRight size={15} />
      </IconButton>
      <Divider />
      <IconButton label="Zoom out" shortcut="Ctrl+−" onClick={() => zoomStep(-1)}>
        <MagnifyingGlassMinus size={15} />
      </IconButton>
      <button
        type="button"
        onClick={() => zoomTo(1)}
        aria-label="Zoom to 100%"
        title="Zoom to 100% (Ctrl+0)"
        className="h-6 min-w-12 rounded-md px-1 text-xs font-semibold text-(--tc-fg) tabular-nums hover:bg-(--tc-control)"
      >
        {Math.round(zoom * 100)}%
      </button>
      <IconButton label="Zoom in" shortcut="Ctrl+=" onClick={() => zoomStep(1)}>
        <MagnifyingGlassPlus size={15} />
      </IconButton>
      <IconButton label={cropping ? 'Zoom to fit' : 'Zoom to fit all'} shortcut="Shift+1" onClick={zoomFit}>
        <CornersIn size={15} />
      </IconButton>
      <Divider />
      <IconButton
        label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        shortcut="Ctrl+Shift+L"
        onClick={() => store.set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' }))}
      >
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </IconButton>
    </div>
  )
}
