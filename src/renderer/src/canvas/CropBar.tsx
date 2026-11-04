import { Check, CornersOut } from '@phosphor-icons/react'
import { leaveCrop } from '../app/actions'
import { updateDoc, useApp } from '../app/store'
import { Button } from '../ui/controls'
import { isNarrow, workspaceGeometry } from './view'

/** Floating bar above the toolbar while cropping: the way out sits next to the thing being cropped. */
export function CropBar() {
  const cropping = useApp((s) => s.mode === 'crop' && s.doc.sourceId !== null)
  const hasCrop = useApp((s) => s.doc.crop !== null)
  const narrow = useApp((s) => isNarrow(s))
  const center = useApp((s) => {
    const g = workspaceGeometry(s)
    return g.area.x + g.area.width / 2
  })
  if (!cropping) return null
  return (
    <div
      role="toolbar"
      aria-label="Crop"
      data-testid="crop-bar"
      className="absolute flex h-10 -translate-x-1/2 items-center gap-1 rounded-lg border border-(--tc-line) bg-(--tc-panel) p-1 text-(--tc-fg) shadow-[var(--tc-panel-shadow)] backdrop-blur-[40px] backdrop-saturate-150"
      style={narrow ? { left: center, top: 56 } : { left: center, bottom: 58 }}
    >
      {hasCrop && (
        <Button icon={<CornersOut size={14} />} onClick={() => updateDoc({ crop: null })} hint="Show the whole screenshot again">
          Reset
        </Button>
      )}
      <Button variant="primary" icon={<Check size={14} />} onClick={leaveCrop} data-testid="crop-done" hint="Back to the framed image (Enter)">
        Done
      </Button>
    </div>
  )
}
