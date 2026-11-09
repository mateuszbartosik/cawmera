import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Pause, Play } from '@phosphor-icons/react'
import type { Doc } from '../app/doc'
import { commitFrom, store, useApp } from '../app/store'
import { PANEL_GAP, PANEL_WIDTH, TIMELINE_SPACE, timelineShows } from '../canvas/view'
import { setRecording } from '../recording/actions'
import { applyTrim, scrubTo, togglePlayback, usePlayhead } from '../recording/playback'
import { getRecording } from '../recording/registry'
import { takeViewFor } from '../recording/take-view'
import { outputToSource, snapToOutput } from '../recording/timemap'
import { isShownClick } from '../recording/track'
import type { Trim } from '../recording/trim'
import { clamp } from '../render/geometry'
import { IconButton } from '../ui/controls'
import { dragTrim, formatClock, formatRulerLabel, tickStep, timeToX, xToTime } from './scale'

const LABEL_WIDTH = 56
const SIDE_PADDING = 12
const BODY_PADDING = 4
const RULER_HEIGHT = 24
const CLIP_HEIGHT = 44
const CLIP_INSET = 4
const HANDLE_WIDTH = 8
const MIN_ZOOM_BLOCK_PX = 28
const KEY_STEP_MS = 100
const KEY_STEP_SHIFT_MS = 1000
const PANEL_BOTTOM = 12

type Edge = 'start' | 'end'

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

/** Stage 1 of the recording timeline: play, scrub, trim, and the clicks and zooms the recording found. */
export function Timeline() {
  const shows = useApp(timelineShows)
  return shows ? <TimelinePanel /> : null
}

function TimelinePanel() {
  const recording = useApp((s) => s.doc.recording)
  const recordingId = useApp((s) => s.doc.sourceId)
  const crop = useApp((s) => s.doc.crop)
  const playing = useApp((s) => s.playback.playing)
  const time = usePlayhead()
  const entry = getRecording(recordingId)
  const { ref: trackRef, width } = useWidth()
  if (!recording || !entry) return null

  const { track } = entry
  const { trim } = recording
  const { map, zooms } = takeViewFor(entry, recording, crop)
  const duration = track.durationMs
  const startX = timeToX(trim.start, duration, width)
  const endX = timeToX(trim.end, duration, width)
  const step = tickStep(duration, width)
  const ticks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step)
  const playheadX = timeToX(clamp(time, trim.start, trim.end), duration, width)
  const shownClicks = track.clicks.filter((click) => isShownClick(click, track))

  const scrubToPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    scrubTo(clamp(xToTime(event.clientX - bounds.left, duration, bounds.width), trim.start, trim.end))
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
      </header>

      <div
        className="relative grid min-h-0 flex-1"
        style={{ gridTemplateRows: `${RULER_HEIGHT}px ${CLIP_HEIGHT}px 1fr`, padding: `${BODY_PADDING}px ${SIDE_PADDING}px` }}
      >
        <div className="grid" style={rowColumns}>
          <span />
          <div className="relative border-b border-(--tc-divider)" aria-hidden>
            {ticks.map((tick) => (
              <span
                key={tick}
                className="absolute bottom-0 h-1.5 border-l border-(--tc-line)"
                style={{ left: timeToX(tick, duration, width) }}
              >
                <span className="absolute bottom-1.5 left-1 text-[10px] leading-3 text-(--tc-value) tabular-nums">{formatRulerLabel(tick)}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="grid" style={rowColumns}>
          <RowLabel>Clip</RowLabel>
          <div className="relative overflow-hidden rounded-md border border-(--tc-line) bg-(--tc-control)" style={{ marginBlock: CLIP_INSET }}>
            {shownClicks.map((click) => (
              <span
                key={click.t}
                className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-(--tc-accent) bg-(--tc-chip)"
                style={{ left: timeToX(click.t, duration, width) }}
              />
            ))}
            <span className="absolute inset-y-0 left-0 bg-(--tc-canvas)/70" style={{ width: startX }} />
            <span className="absolute inset-y-0 right-0 bg-(--tc-canvas)/70" style={{ width: width - endX }} />
          </div>
        </div>

        <div className="grid" style={rowColumns}>
          <RowLabel>Zoom</RowLabel>
          <div className="relative">
            {zooms.map((zoom) => {
              const left = timeToX(outputToSource(map, zoom.start), duration, width)
              const right = timeToX(outputToSource(map, zoom.end), duration, width)
              return (
                <span
                  key={zoom.start}
                  className="absolute top-1/2 grid h-6 -translate-y-1/2 place-items-center rounded-md border border-(--tc-accent)/60 bg-(--tc-accent)/15 text-[11px] font-semibold text-(--tc-fg) tabular-nums"
                  style={{ left, width: Math.max(MIN_ZOOM_BLOCK_PX, right - left) }}
                >
                  {zoom.depth.toFixed(1)}×
                </span>
              )
            })}
          </div>
        </div>

        <div
          ref={trackRef}
          data-testid="timeline-track"
          className="absolute cursor-pointer touch-none"
          style={{ top: BODY_PADDING, bottom: BODY_PADDING, left: SIDE_PADDING + LABEL_WIDTH, right: SIDE_PADDING }}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            scrubToPointer(event)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) scrubToPointer(event)
          }}
        >
          <TrimHandle edge="start" trim={trim} duration={duration} x={startX} />
          <TrimHandle edge="end" trim={trim} duration={duration} x={endX} />
          <div className="pointer-events-none absolute inset-y-0 w-px bg-(--tc-accent)" style={{ left: playheadX }} data-testid="timeline-playhead">
            <span className="absolute -top-0.5 -left-1 size-2.5 rounded-full bg-(--tc-accent)" />
          </div>
        </div>
      </div>
    </section>
  )
}

function TrimHandle({ edge, trim, duration, x }: { edge: Edge; trim: Trim; duration: number; x: number }) {
  const docBeforeDrag = useRef<Doc | null>(null)
  const grabOffset = useRef(0)
  const docBeforeKeys = useRef<Doc | null>(null)

  const finish = (before: { current: Doc | null }) => {
    if (before.current) commitFrom(before.current)
    before.current = null
  }
  const moveEdgeTo = (t: number) => {
    const current = store.get().doc.recording?.trim
    if (!current) return
    const next = dragTrim(current, edge, t, duration)
    setRecording({ trim: next }, false)
    applyTrim(next)
    scrubTo(next[edge])
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (direction === 0) return
    event.preventDefault()
    docBeforeKeys.current ??= store.get().doc
    const current = store.get().doc.recording?.trim ?? trim
    moveEdgeTo(current[edge] + direction * (event.shiftKey ? KEY_STEP_SHIFT_MS : KEY_STEP_MS))
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={edge === 'start' ? 'Trim start' : 'Trim end'}
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={Math.round(trim[edge])}
      aria-valuetext={formatClock(trim[edge])}
      className="absolute z-10 cursor-ew-resize rounded-sm bg-(--tc-fg) outline-none focus-visible:ring-2 focus-visible:ring-(--tc-accent)/50"
      style={{
        left: x,
        top: RULER_HEIGHT + CLIP_INSET + 2,
        height: CLIP_HEIGHT - CLIP_INSET * 2 - 4,
        width: HANDLE_WIDTH,
        translate: edge === 'end' ? '-100%' : undefined
      }}
      onKeyDown={onKeyDown}
      onKeyUp={() => finish(docBeforeKeys)}
      onBlur={() => finish(docBeforeKeys)}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        const bounds = event.currentTarget.parentElement!.getBoundingClientRect()
        grabOffset.current = event.clientX - bounds.left - x
        docBeforeDrag.current = store.get().doc
      }}
      onPointerMove={(event) => {
        if (!docBeforeDrag.current) return
        const bounds = event.currentTarget.parentElement!.getBoundingClientRect()
        moveEdgeTo(xToTime(event.clientX - bounds.left - grabOffset.current, duration, bounds.width))
      }}
      onPointerUp={() => finish(docBeforeDrag)}
      onPointerCancel={() => finish(docBeforeDrag)}
      onLostPointerCapture={() => finish(docBeforeDrag)}
    />
  )
}
