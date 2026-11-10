import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MagnifyingGlassMinus, MagnifyingGlassPlus, Pause, Play } from '@phosphor-icons/react'
import { store, useApp } from '../app/store'
import { PANEL_GAP, PANEL_WIDTH, TIMELINE_SPACE, timelineShows } from '../canvas/view'
import { togglePlayback, usePlayhead } from '../recording/playback'
import { getRecording } from '../recording/registry'
import { takeViewFor } from '../recording/take-view'
import { snapToOutput } from '../recording/timemap'
import { isShownClick } from '../recording/track'
import { IconButton } from '../ui/controls'
import { ClipRow } from './ClipRow'
import { BODY_PADDING, CLIP_HEIGHT, LABEL_WIDTH, RULER_HEIGHT, SIDE_PADDING } from './layout'
import { Playhead } from './Playhead'
import { Ruler } from './Ruler'
import { fitView, formatClock, MIN_VIEW_MS, scrollView, VIEW_ZOOM_STEP, xToTime, zoomView, type TimelineView } from './scale'
import { TrimHandle } from './TrimHandle'
import { ZoomRow } from './ZoomRow'

const PANEL_BOTTOM = 12
const WHEEL_ZOOM_RATE = 0.0022

function showView(current: TimelineView, next: TimelineView) {
  if (next.start !== current.start || next.end !== current.end) store.set({ timelineView: next })
}

const rowColumns = { gridTemplateColumns: `${LABEL_WIDTH}px 1fr` }

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

function RowLabel({ children }: { children: string }) {
  return <span className="self-center text-[11px] font-medium text-(--tc-label)">{children}</span>
}

/** The recording timeline: play, scrub, trim, and the clicks and zooms the recording found, over a window that zooms and scrolls. */
export function Timeline() {
  const shows = useApp(timelineShows)
  return shows ? <TimelinePanel /> : null
}

function TimelinePanel() {
  const recording = useApp((s) => s.doc.recording)
  const recordingId = useApp((s) => s.doc.sourceId)
  const crop = useApp((s) => s.doc.crop)
  const playing = useApp((s) => s.playback.playing)
  const storedView = useApp((s) => s.timelineView)
  const time = usePlayhead()
  const entry = getRecording(recordingId)
  const { ref: trackRef, width } = useWidth()
  const bodyRef = useRef<HTMLDivElement>(null)
  const duration = entry?.track.durationMs ?? 0

  useEffect(() => {
    const body = bodyRef.current
    const track = trackRef.current
    if (!body || !track) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const view = fitView(store.get().timelineView, duration)
      const bounds = track.getBoundingClientRect()
      if (event.ctrlKey || event.metaKey) {
        const anchor = xToTime(event.clientX - bounds.left, view, bounds.width)
        showView(view, zoomView(view, Math.exp(-event.deltaY * WHEEL_ZOOM_RATE), anchor, duration))
        return
      }
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      showView(view, scrollView(view, (delta / Math.max(bounds.width, 1)) * (view.end - view.start), duration))
    }
    body.addEventListener('wheel', onWheel, { passive: false })
    return () => body.removeEventListener('wheel', onWheel)
  }, [duration, trackRef])

  if (!recording || !entry) return null

  const { track } = entry
  const { trim } = recording
  const { map, edits } = takeViewFor(entry, recording, crop)
  const view = fitView(storedView, duration)
  const viewLength = view.end - view.start
  const shownClicks = track.clicks.filter((click) => isShownClick(click, track))

  const zoomAroundPlayhead = (factor: number) => {
    const anchor = time >= view.start && time <= view.end ? time : view.start + viewLength / 2
    store.set({ timelineView: zoomView(view, factor, anchor, duration) })
  }

  return (
    <section
      aria-label="Timeline"
      data-testid="timeline"
      className="absolute flex flex-col rounded-xl border border-(--tc-line) bg-(--tc-panel) text-(--tc-fg) shadow-[var(--tc-panel-shadow)] backdrop-blur-[40px] backdrop-saturate-150"
      style={{ left: PANEL_GAP, right: PANEL_WIDTH + PANEL_GAP * 2, bottom: PANEL_BOTTOM, height: TIMELINE_SPACE - PANEL_BOTTOM }}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-(--tc-divider) px-3">
        <IconButton label={playing ? 'Pause' : 'Play'} onClick={togglePlayback} data-testid="timeline-play">
          {playing ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
        </IconButton>
        <span className="text-xs font-semibold tabular-nums" data-testid="timeline-time">
          {formatClock(snapToOutput(map, time))} <span className="font-normal text-(--tc-value)">/ {formatClock(map.outputMs)}</span>
        </span>
        <span className="ml-auto flex items-center gap-1">
          <IconButton label="Zoom out" disabled={viewLength >= duration} onClick={() => zoomAroundPlayhead(1 / VIEW_ZOOM_STEP)} data-testid="timeline-zoom-out">
            <MagnifyingGlassMinus size={15} />
          </IconButton>
          <IconButton
            label="Zoom in"
            disabled={viewLength <= Math.min(MIN_VIEW_MS, duration)}
            onClick={() => zoomAroundPlayhead(VIEW_ZOOM_STEP)}
            data-testid="timeline-zoom-in"
          >
            <MagnifyingGlassPlus size={15} />
          </IconButton>
        </span>
      </header>

      <div
        ref={bodyRef}
        className="relative grid min-h-0 flex-1"
        style={{ gridTemplateRows: `${RULER_HEIGHT}px ${CLIP_HEIGHT}px 1fr`, padding: `${BODY_PADDING}px ${SIDE_PADDING}px` }}
      >
        <div className="grid" style={rowColumns}>
          <span />
          <Ruler view={view} width={width} trim={trim} />
        </div>

        <div className="grid" style={rowColumns}>
          <RowLabel>Clip</RowLabel>
          <ClipRow clicks={shownClicks} trim={trim} view={view} width={width} />
        </div>

        <div className="grid" style={rowColumns}>
          <RowLabel>Zoom</RowLabel>
          <ZoomRow edits={edits} view={view} width={width} />
        </div>

        <div
          ref={trackRef}
          data-testid="timeline-track"
          className="pointer-events-none absolute"
          style={{ top: BODY_PADDING, bottom: BODY_PADDING, left: SIDE_PADDING + LABEL_WIDTH, right: SIDE_PADDING }}
        >
          <TrimHandle edge="start" trim={trim} duration={duration} view={view} width={width} />
          <TrimHandle edge="end" trim={trim} duration={duration} view={view} width={width} />
          <Playhead time={time} trim={trim} view={view} width={width} />
        </div>
      </div>
    </section>
  )
}
