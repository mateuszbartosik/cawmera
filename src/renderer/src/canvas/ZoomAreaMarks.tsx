import { useMemo } from 'react'
import type { Doc } from '../app/doc'
import type { HouseStyle } from '../app/house-style'
import type { TimelineSelection } from '../app/store'
import { recordingEditLayout } from '../recording/edit-layout'
import { getRecording } from '../recording/registry'
import { takeViewFor, type TakeView } from '../recording/take-view'
import type { Click } from '../recording/track'
import { selectedZoomOf, zoomAreaLabel } from '../recording/zoom-actions'
import { clicksCovered, type ZoomEdit } from '../recording/zoom-edits'
import { aimedArea, CORNERS } from '../recording/zoom-area'
import { handlePoint, type Point, type Rect, type Size } from '../render/geometry'
import { sourceRectToOutput, sourceToOutput } from '../render/layout'

const HANDLE_PX = 7
const LABEL_GAP_PX = 4

/** The selected zoom’s area on the active recording shot. */
export interface ZoomArea {
  zoom: ZoomEdit
  take: TakeView
  /** Frame px. */
  area: Rect
  /** Export px per frame px. */
  scale: number
  /** Export px, in the shot. */
  out: Rect
  dots: { number: number; at: Point }[]
}

function zoomAreaOf(zoom: ZoomEdit, covered: Click[], take: TakeView, video: Size, output: Size, style: HouseStyle, playhead: number): ZoomArea {
  const { area, clicks } = aimedArea(zoom, covered, take, playhead)
  const layout = recordingEditLayout(take, video, output, style)
  const { crop } = take
  const inVideo = (p: Point): Point => ({ x: p.x + crop.x, y: p.y + crop.y })
  return {
    zoom,
    take,
    area,
    scale: layout.scale,
    out: sourceRectToOutput(layout, { ...inVideo(area), w: area.w, h: area.h }),
    dots: clicks.map((click) => ({ number: covered.indexOf(click) + 1, at: sourceToOutput(layout, inVideo(click)) }))
  }
}

/** The area of the zoom the timeline selects, while the take shows that zoom; only its clicks are looked up. */
export function useZoomArea(doc: Doc, style: HouseStyle, selection: TimelineSelection, playhead: number): ZoomArea | null {
  const entry = doc.recording ? getRecording(doc.sourceId) : null
  const take = entry && doc.recording ? takeViewFor(entry, doc.recording, doc.crop) : null
  const zoom = take ? selectedZoomOf(take.edits, selection) : null
  const speed = doc.recording?.zoomSpeed ?? null
  const covered = useMemo(() => (zoom && take && speed ? clicksCovered(zoom, take, speed) : []), [zoom, take, speed])
  return zoom && take && entry ? zoomAreaOf(zoom, covered, take, entry.track, doc.size, style, playhead) : null
}

/** Over the wide frame: the area dashed, with corner handles, its depth and aim, and its clicks numbered. */
export function ZoomAreaMarks({
  shown,
  box,
  size,
  k
}: {
  shown: ZoomArea
  box: { left: number; top: number; width: number; height: number }
  size: Size
  k: number
}) {
  const { zoom, out, dots } = shown
  const unit = 1 / k
  const handle = HANDLE_PX * unit
  return (
    <>
      <svg
        className="pointer-events-none absolute overflow-visible"
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        viewBox={`0 0 ${size.width} ${size.height}`}
        preserveAspectRatio="none"
        aria-hidden
        data-testid="zoom-area"
      >
        <rect
          x={out.x}
          y={out.y}
          width={out.w}
          height={out.h}
          rx={3 * unit}
          fill="var(--tc-accent)"
          fillOpacity={0.07}
          stroke="var(--tc-accent)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
        {CORNERS.map((corner) => {
          const at = handlePoint(out, corner)
          return (
            <rect
              key={corner}
              x={at.x - handle / 2}
              y={at.y - handle / 2}
              width={handle}
              height={handle}
              rx={1.5 * unit}
              fill="#fff"
              stroke="var(--tc-accent)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
      </svg>
      <span
        className="pointer-events-none absolute flex h-[18px] -translate-y-full items-center rounded-[5px] bg-(--tc-accent) px-[7px] text-[10.5px] font-semibold whitespace-nowrap text-white tabular-nums"
        style={{ left: box.left + out.x * k, top: box.top + out.y * k - LABEL_GAP_PX }}
        aria-hidden
        data-testid="zoom-area-label"
      >
        {zoomAreaLabel(zoom)}
      </span>
      {dots.map(({ number, at }) => (
        <span
          key={number}
          className="pointer-events-none absolute grid size-[13px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-(--tc-accent) text-[8px] leading-none font-bold text-white tabular-nums shadow-[0_0_0_2px_rgb(255_255_255/0.9)]"
          style={{ left: box.left + at.x * k, top: box.top + at.y * k }}
          aria-hidden
        >
          {number}
        </span>
      ))}
    </>
  )
}
