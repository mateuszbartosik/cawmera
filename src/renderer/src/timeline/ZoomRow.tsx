import { useEffect, useRef, type MouseEvent } from 'react'
import { useApp } from '../app/store'
import { addZoomAt, moveZoomTo, selectZoom, stretchZoomTo } from '../recording/zoom-actions'
import type { ZoomEdit } from '../recording/zoom-edits'
import { cn } from '../ui/controls'
import { timelinePress, useDragSession, type TimelinePress } from './drag-session'
import { xToTime, type TimelineView } from './scale'
import { drawnBlock, dragTarget, EDGE_GRAB_PX, grabAt, isBlockVisible, zoomAtX, type Grab } from './zoom-drag'

interface ZoomRowProps { edits: ZoomEdit[]; view: TimelineView; width: number }
interface DraggedZoom { id: string; grab: Grab; press: TimelinePress }

const ZOOM_ID_ATTRIBUTE = 'data-zoom-id'

function ZoomBlock({ zoom, selected, view, width }: { zoom: ZoomEdit; selected: boolean; view: TimelineView; width: number }) {
  const block = drawnBlock(zoom, view, width)
  if (!isBlockVisible(block, width)) return null
  return (
    <div
      role="button"
      aria-pressed={selected}
      aria-label={`Zoom ${zoom.depth.toFixed(1)}×`}
      data-testid="zoom-block"
      {...{ [ZOOM_ID_ATTRIBUTE]: zoom.id }}
      className={cn(
        'absolute top-1/2 grid h-6 -translate-y-1/2 cursor-grab place-items-center rounded-md border text-[11px] font-semibold text-(--tc-fg) tabular-nums select-none',
        selected ? 'border-(--tc-accent) bg-(--tc-accent)/35' : 'border-(--tc-accent)/60 bg-(--tc-accent)/15 hover:bg-(--tc-accent)/25'
      )}
      style={{ left: block.left, width: block.width }}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 cursor-ew-resize" style={{ width: EDGE_GRAB_PX }} />
      <span aria-hidden className="absolute inset-y-0 right-0 cursor-ew-resize" style={{ width: EDGE_GRAB_PX }} />
      {zoom.depth.toFixed(1)}×
    </div>
  )
}

export function ZoomRow({ edits, view, width }: ZoomRowProps) {
  const selection = useApp((s) => s.timelineSelection)
  const selectedId = selection?.kind === 'zoom' ? selection.id : null
  const session = useDragSession()
  const dragged = useRef<DraggedZoom | null>(null)

  const endDrag = () => {
    session.end()
    dragged.current = null
  }
  const pointerX = (event: MouseEvent<HTMLElement>) => event.clientX - event.currentTarget.getBoundingClientRect().left

  useEffect(() => {
    if (!dragged.current) return
    const { id } = dragged.current
    const zoom = edits.find((edit) => edit.id === id)
    if (!zoom || !isBlockVisible(drawnBlock(zoom, view, width), width)) endDrag()
  }, [edits, view, width])

  return (
    <div
      className="relative touch-none overflow-hidden"
      data-testid="zoom-row"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        const element = (event.target as HTMLElement).closest<HTMLElement>(`[${ZOOM_ID_ATTRIBUTE}]`)
        const zoom = edits.find((edit) => edit.id === element?.getAttribute(ZOOM_ID_ATTRIBUTE))
        if (!zoom) {
          if (selectedId !== null) selectZoom(null)
          return
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        const x = pointerX(event)
        dragged.current = { id: zoom.id, grab: grabAt(zoom, x, view, width), press: timelinePress(x) }
        selectZoom(zoom.id)
        session.begin()
      }}
      onPointerMove={(event) => {
        if (!session.accepts(event.buttons) || !dragged.current) return
        const { id, grab, press } = dragged.current
        const x = pointerX(event)
        if (!press.dragsAt(x)) return
        const target = dragTarget(grab, x, view, width)
        dragged.current.id = grab.kind === 'move' ? moveZoomTo(id, target, false) : stretchZoomTo(id, grab.kind, target, false)
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={(event) => {
        const x = pointerX(event)
        if (!zoomAtX(edits, x, view, width)) addZoomAt(xToTime(x, view, width))
      }}
    >
      {edits.map((zoom) => (
        <ZoomBlock key={zoom.id} zoom={zoom} selected={zoom.id === selectedId} view={view} width={width} />
      ))}
    </div>
  )
}
