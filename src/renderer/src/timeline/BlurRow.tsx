import { useEffect, useRef, type MouseEvent } from 'react'
import { REDACT_LABEL, type Redaction } from '../app/doc'
import { store, useApp } from '../app/store'
import { moveRedactionTo, selectRedaction, stretchRedactionTo } from '../recording/blur-actions'
import type { Span } from '../recording/timemap'
import { cn } from '../ui/controls'
import { useDragSession } from './drag-session'
import type { TimelineView } from './scale'
import { drawnBlock, dragTarget, EDGE_GRAB_PX, grabAt, isBlockVisible, redactionAtX, type Grab } from './zoom-drag'

interface BlurRowProps { redactions: Redaction[]; view: TimelineView; width: number }
interface DraggedBox { id: string; grab: Grab }
type TimedRedaction = Redaction & { time: Span }

const isTimed = (redaction: Redaction): redaction is TimedRedaction => redaction.time !== null

function BlurBlock({ box, label, selected, view, width }: { box: TimedRedaction; label: string; selected: boolean; view: TimelineView; width: number }) {
  const block = drawnBlock(box.time, view, width)
  if (!isBlockVisible(block, width)) return null
  return (
    <div
      role="button"
      aria-pressed={selected}
      aria-label={`${label} box`}
      data-testid="blur-block"
      className={cn(
        'absolute top-1/2 grid h-6 -translate-y-1/2 cursor-grab place-items-center overflow-hidden rounded-md border text-[11px] font-semibold text-(--tc-fg) select-none',
        selected ? 'border-(--tc-fg) bg-(--tc-fg)/25' : 'border-(--tc-line) bg-(--tc-fg)/10 hover:bg-(--tc-fg)/15'
      )}
      style={{ left: block.left, width: block.width }}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 cursor-ew-resize" style={{ width: EDGE_GRAB_PX }} />
      <span aria-hidden className="absolute inset-y-0 right-0 cursor-ew-resize" style={{ width: EDGE_GRAB_PX }} />
      {label}
    </div>
  )
}

/** The timed blur boxes of a recording as blocks: press to select, drag to move, drag an end to stretch. */
export function BlurRow({ redactions, view, width }: BlurRowProps) {
  const selection = useApp((s) => s.selection)
  const redactStyle = useApp((s) => s.doc.redactStyle)
  const selectedId = selection.length === 1 && selection[0].kind === 'redaction' ? selection[0].id : null
  const boxes = redactions.filter(isTimed)
  const session = useDragSession()
  const dragged = useRef<DraggedBox | null>(null)

  const endDrag = () => {
    session.end()
    dragged.current = null
  }
  const pointerX = (event: MouseEvent<HTMLElement>) => event.clientX - event.currentTarget.getBoundingClientRect().left

  useEffect(() => {
    if (!dragged.current) return
    const { id } = dragged.current
    const box = boxes.find((candidate) => candidate.id === id)
    if (!box || !isBlockVisible(drawnBlock(box.time, view, width), width)) endDrag()
  }, [redactions, view, width])

  return (
    <div
      className="relative touch-none overflow-hidden"
      data-testid="blur-row"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        const x = pointerX(event)
        const box = redactionAtX(boxes, x, view, width)
        if (!box) {
          if (store.get().selection.length > 0) store.set({ selection: [] })
          return
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        dragged.current = { id: box.id, grab: grabAt(box.time!, x, view, width) }
        selectRedaction(box.id)
        session.begin()
      }}
      onPointerMove={(event) => {
        if (!session.accepts(event.buttons) || !dragged.current) return
        const { id, grab } = dragged.current
        const target = dragTarget(grab, pointerX(event), view, width)
        if (grab.kind === 'move') moveRedactionTo(id, target, false)
        else stretchRedactionTo(id, grab.kind, target, false)
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    >
      {boxes.map((box) => (
        <BlurBlock key={box.id} box={box} label={REDACT_LABEL[redactStyle]} selected={box.id === selectedId} view={view} width={width} />
      ))}
    </div>
  )
}
