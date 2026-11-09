import { useRef, type ReactNode } from 'react'
import { snapDensity, type Doc } from '../app/doc'
import { commitFrom, store, useApp } from '../app/store'
import { setRecording } from '../recording/actions'
import type { ClickEffect } from '../recording/effects'
import type { CursorLook } from '../recording/cursor-art'
import type { ZoomSpeed } from '../recording/camera'
import { getRecording } from '../recording/registry'
import { defaultsFor, differsFromDefault, type RecordingDoc } from '../recording/settings'
import { takeViewFor } from '../recording/take-view'
import { percent, Section, Segmented, Slider, Switch } from '../ui/controls'
import { useSection } from './useSection'

const CURSOR_KEYS = ['cursorSize', 'smoothing', 'look', 'clickEffect', 'hideWhenStill', 'tilt'] as const
const MOTION_KEYS = ['cursorBlur', 'cameraBlur', 'zoomSpeed'] as const

const LOOK_OPTIONS: { value: CursorLook; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]
const CLICK_EFFECT_OPTIONS: { value: ClickEffect; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'ring', label: 'Ring' },
  { value: 'ripple', label: 'Ripple' }
]
const ZOOM_SPEED_OPTIONS: { value: ZoomSpeed; label: string }[] = [
  { value: 'calm', label: 'Calm' },
  { value: 'quick', label: 'Quick' }
]

const times = (value: number) => `${value.toFixed(1)}×`

function formatLength(ms: number) {
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** One undo step per slider drag, like the light controls. */
function useSliderDrag() {
  const before = useRef<Doc | null>(null)
  return {
    change: (patch: Partial<RecordingDoc>) => {
      before.current ??= store.get().doc
      setRecording(patch, false)
    },
    commit: () => {
      if (before.current) commitFrom(before.current)
      before.current = null
    }
  }
}

function Readout({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-[17px] items-center justify-between gap-2">
      <span className="text-xs leading-[16.5px] font-medium text-(--tc-label)">{label}</span>
      <span className="min-w-0 truncate text-xs leading-5 text-(--tc-value) tabular-nums">{value}</span>
    </div>
  )
}

export function RecordingSection() {
  const sourceId = useApp((s) => s.doc.sourceId)
  const recording = useApp((s) => s.doc.recording)
  const crop = useApp((s) => s.doc.crop)
  const section = useSection('recording')
  const entry = getRecording(sourceId)
  if (!entry || !recording) return null
  const { track } = entry
  return (
    <Section title="Recording" testId="section-recording" {...section}>
      <Readout label="Source" value={entry.name} />
      <Readout label="Length" value={formatLength(takeViewFor(entry, recording, crop).map.outputMs)} />
      <Readout label="Video" value={`${track.width} × ${track.height}`} />
      <Readout label="Captured at" value={`${snapDensity(track.scale)}×`} />
    </Section>
  )
}

export function CursorSection() {
  const recording = useApp((s) => s.doc.recording)
  const section = useSection('cursor')
  const drag = useSliderDrag()
  if (!recording) return null
  return (
    <Section
      title="Cursor"
      testId="section-cursor"
      {...section}
      onReset={differsFromDefault(recording, CURSOR_KEYS) ? () => setRecording(defaultsFor(CURSOR_KEYS)) : undefined}
      resetLabel="Back to the default cursor"
    >
      <Slider
        label="Size"
        value={recording.cursorSize}
        min={0.5}
        max={3}
        step={0.1}
        format={times}
        onChange={(cursorSize) => drag.change({ cursorSize })}
        onCommit={drag.commit}
      />
      <Slider
        label="Smoothing"
        help="Evens out hand shake. At 0% the cursor follows the recorded path exactly."
        value={recording.smoothing}
        min={0}
        max={1}
        step={0.05}
        format={percent}
        onChange={(smoothing) => drag.change({ smoothing })}
        onCommit={drag.commit}
      />
      <Segmented label="Style" value={recording.look} options={LOOK_OPTIONS} onChange={(look) => setRecording({ look })} testId="cursor-look" />
      <Segmented
        label="Click effect"
        value={recording.clickEffect}
        options={CLICK_EFFECT_OPTIONS}
        onChange={(clickEffect) => setRecording({ clickEffect })}
        testId="click-effect"
      />
      <Switch label="Hide when still" checked={recording.hideWhenStill} onChange={(hideWhenStill) => setRecording({ hideWhenStill })} testId="hide-when-still" />
      <Switch label="Tilt while moving" checked={recording.tilt} onChange={(tilt) => setRecording({ tilt })} testId="tilt-while-moving" />
    </Section>
  )
}

export function MotionSection() {
  const recording = useApp((s) => s.doc.recording)
  const section = useSection('motion')
  const drag = useSliderDrag()
  if (!recording) return null
  return (
    <Section
      title="Motion"
      testId="section-motion"
      {...section}
      onReset={differsFromDefault(recording, MOTION_KEYS) ? () => setRecording(defaultsFor(MOTION_KEYS)) : undefined}
      resetLabel="Back to the default motion"
    >
      <Slider
        label="Cursor blur"
        help="Smears the cursor while it moves. A still cursor stays sharp."
        value={recording.cursorBlur}
        min={0}
        max={1}
        step={0.05}
        format={percent}
        onChange={(cursorBlur) => drag.change({ cursorBlur })}
        onCommit={drag.commit}
      />
      <Slider
        label="Camera blur"
        help="Smears zooms and pans while they move. The picture is sharp at rest."
        value={recording.cameraBlur}
        min={0}
        max={1}
        step={0.05}
        format={percent}
        onChange={(cameraBlur) => drag.change({ cameraBlur })}
        onCommit={drag.commit}
      />
      <Segmented label="Zoom speed" value={recording.zoomSpeed} options={ZOOM_SPEED_OPTIONS} onChange={(zoomSpeed) => setRecording({ zoomSpeed })} testId="zoom-speed" />
    </Section>
  )
}
