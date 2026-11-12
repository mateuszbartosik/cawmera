import { useEffect, useRef, type MouseEvent } from 'react'
import type { Doc } from '../app/doc'
import { commitFrom, store, useApp } from '../app/store'
import { addZoomAt, moveSelectedZoom, selectZoom, stretchSelectedZoom } from '../recording/zoom-actions'
import type { ZoomEdit } from '../recording/zoom-edits'
import { cn } from '../ui/controls'
import { dragSession } from './drag-session'
import { timeToX, xToTime, type TimelineView } from './scale'

const MIN_ZOOM_BLOCK_PX = 28
const EDGE_GRAB_PX = 7

type Grab = { kind: 'move' | 'start' | 'end'; offsetMs: number }

interface ZoomRowProps { edits: ZoomEdit[]; view: TimelineView; width: number }
interface ZoomBlockProps { zoom: ZoomEdit; selected: boolean; view: TimelineView; width: number }

function ZoomBlock({ zoom, selected, view, width }: ZoomBlockProps) {
  const drag = useRef(dragSession<Doc>(commitFrom))
  const grab = useRef<Grab>({ kind: 'move', offsetMs: 0 })
  const left = timeToX(zoom.start, view, width)
  const right = timeToX(zoom.end, view, width)
  const blockWidth = Math.max(MIN_ZOOM_BLOCK_PX, right - left)
  const visible = left + blockWidth > 0 && left < width

  useEffect(() => () => drag.current.end(), [])

  useEffect(() => {
    if (!visible) drag.current.end()
  }, [visible])

  if (!visible) return null

  const timeAt = (event: MouseEvent<HTMLElement>) => {
    const bounds = event.currentTarget.parentElement!.getBoundingClientRect()
    return xToTime(event.clientX - bounds.left, view, bounds.width)
  }
  const grabAt = (event: MouseEvent<HTMLElement>): Grab => {
    const x = event.clientX - event.currentTarget.getBoundingClientRect().left
    const t = timeAt(event)
    if (x < EDGE_GRAB_PX) return { kind: 'start', offsetMs: t - zoom.start }
    if (x > blockWidth - EDGE_GRAB_PX) return { kind: 'end', offsetMs: t - zoom.end }
    return { kind: 'move', offsetMs: t - zoom.start }
  }

  return (
    <div
      role="button"
      aria-pressed={selected}
      aria-label={`Zoom ${zoom.depth.toFixed(1)}×`}
      data-testid="zoom-block"
      className={cn(
        'absolute top-1/2 grid h-6 -translate-y-1/2 cursor-grab touch-none place-items-center rounded-md border text-[11px] font-semibold text-(--tc-fg) tabular-nums select-none',
        selected ? 'border-(--tc-accent) bg-(--tc-accent)/35' : 'border-(--tc-accent)/60 bg-(--tc-accent)/15 hover:bg-(--tc-accent)/25'
      )}
      style={{ left, width: blockWidth }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        grab.current = grabAt(event)
        selectZoom(zoom.id)
        drag.current.begin(store.get().doc)
      }}
      onPointerMove={(event) => {
        const { kind, offsetMs } = grab.current
        if (!drag.current.accepts(event.buttons)) return
        const t = timeAt(event) - offsetMs
        if (kind === 'move') moveSelectedZoom(t, false)
        else stretchSelectedZoom(kind, t, false)
      }}
      onPointerUp={() => drag.current.end()}
      onPointerCancel={() => drag.current.end()}
      onLostPointerCapture={() => drag.current.end()}
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

  const timeAt = (event: MouseEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return xToTime(event.clientX - bounds.left, view, bounds.width)
  }

  return (
    <div
      className="relative overflow-hidden"
      data-testid="zoom-row"
      onPointerDown={(event) => {
        if (event.button === 0 && event.target === event.currentTarget && selectedId !== null) selectZoom(null)
      }}
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget) addZoomAt(timeAt(event))
      }}
    >
      {edits.map((zoom, index) => (
        // Index keys: the first edit renames automatic zooms, and a block being dragged has to stay mounted through it.
        <ZoomBlock key={index} zoom={zoom} selected={zoom.id === selectedId} view={view} width={width} />
      ))}
    </div>
  )
}
