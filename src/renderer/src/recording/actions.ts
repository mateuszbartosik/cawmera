import { toast } from 'sonner'
import type { CaptureSource, RecordingError, RecordingFinished } from '@shared/types'
import { countdown, interruptCountdown, resetCancellation } from '../app/actions'
import { exportFileName, shotFallbackName, type Doc } from '../app/doc'
import { toastExportFailed, toastSaved } from '../app/save-toast'
import { addShot, backdropReady, emptyDoc, liveShots, markSnapshotSaved, store, updateDoc } from '../app/store'
import { revealActive } from '../canvas/view'
import { bridge, saveVideo } from '../platform/bridge'
import { getRecording, loadPoster, registerRecording } from './registry'
import { runStartFlow } from './start-flow'
import { RECORDING_SIZE, recordingDocFor, type RecordingDoc } from './settings'
import { unavailableReason } from './support'
import { parseTrack, stopClickOf, withoutStopClick } from './track'

const DEFAULT_RECORDING_NAME = 'Recording'

export const PRIVACY_SETTING_PATH = 'Settings › Privacy & security › Screenshots and screen recording'
export const DESKTOP_APPS_SWITCH = 'Let desktop apps take screenshots and record the screen'

const idle = () => store.set({ capture: { phase: 'idle', remaining: 0 } })

export function startRecordingPicker() {
  if (!bridge || store.get().capture.phase !== 'idle') return
  store.set({ captureMode: 'recording', capture: { phase: 'picking', remaining: 0 } })
}

function toastFor(error: RecordingError) {
  switch (error.code) {
    case 'cancelled':
      return
    case 'access-denied':
      toast.error('Windows blocked the recording', {
        description: `In ${PRIVACY_SETTING_PATH}, turn on “${DESKTOP_APPS_SWITCH}”, then try again.`
      })
      return
    case 'unsupported':
      if (error.reason) toast.error(unavailableReason(error.reason))
      else toast.error('Recording isn’t available', { description: error.message })
      return
    case 'target-gone':
      toast.error('The window to record is gone', { description: 'Pick it again.' })
      return
    default:
      toast.error('Recording failed', { description: error.message })
  }
}

let recordingName = DEFAULT_RECORDING_NAME
let recordSourceRunning = false

export async function recordSource(source: CaptureSource) {
  if (!bridge || recordSourceRunning) return
  const target = bridge
  const { delay: seconds, doc, style } = store.get()
  recordSourceRunning = true
  resetCancellation()
  recordingName = source.name
  store.set({ capture: { phase: 'grabbing', remaining: 0 } })
  try {
    const began = await runStartFlow({
      hideWindow: () => target.hideWindow(),
      restoreWindow: () => target.restoreWindow(),
      startRecording: () => target.startRecording({ sourceId: source.id, displayId: source.displayId }),
      beginRecording: () => target.beginRecording(),
      stopRecording: () => target.stopRecording(),
      countdown: {
        show: () => target.showCountdown({ displayId: source.displayId, seconds, color: doc.lightColor ?? style.glow }),
        run: async () => {
          const finished = await countdown(seconds, (remaining) => {
            target.tickCountdown(remaining)
            target.setProgress((seconds - remaining + 1) / (seconds + 1))
          })
          // Cancel already set the phase to idle; stay busy until the cleanup is done.
          if (!finished) store.set({ capture: { phase: 'grabbing', remaining: 0 } })
          return finished
        },
        interrupt: interruptCountdown,
        hide: () => target.hideCountdown()
      },
      showError: toastFor
    })
    store.set({ capture: { phase: began ? 'recording' : 'idle', remaining: 0 } })
  } finally {
    recordSourceRunning = false
  }
}

/** Reports a take that broke after it began. */
export async function recordingFailed(error: RecordingError) {
  idle()
  recordingName = DEFAULT_RECORDING_NAME
  await bridge?.restoreWindow()
  toastFor(error)
}

export async function finishRecording(result: RecordingFinished) {
  try {
    const recorded = parseTrack(JSON.parse(result.track))
    const track = withoutStopClick(recorded, result.stoppedBy)
    registerRecording({ id: result.id, name: recordingName, track, poster: null })
    const settings = recordingDocFor(track, lastRecordingDoc()?.recording ?? null, stopClickOf(recorded, result.stoppedBy))
    addRecordingShot(result.id, settings)
    await loadPoster(result.id)
  } catch (error) {
    console.error('Recording could not be opened', error)
    toast.error('The recording could not be opened', { description: error instanceof Error ? error.message : String(error) })
  } finally {
    idle()
    recordingName = DEFAULT_RECORDING_NAME
    await bridge?.restoreWindow()
  }
}

const lastRecordingDoc = (): Doc | undefined => liveShots().findLast((record) => record.doc.recording !== null)?.doc

/** An empty active shot takes the recording, like a screenshot; otherwise it gets a new shot at the end of the row. */
function addRecordingShot(id: string, settings: RecordingDoc) {
  const current = store.get().doc
  const fillsActive = current.sourceId === null
  const base = fillsActive ? current : emptyDoc(liveShots().at(-1)?.doc)
  const doc: Doc = {
    ...base,
    sourceId: id,
    size: lastRecordingDoc()?.size ?? RECORDING_SIZE,
    recording: settings,
    fileName: ''
  }
  if (fillsActive) updateDoc(doc)
  else addShot(doc)
  store.set({ mode: 'compose', selection: [], playback: { playing: false, time: settings.trim.start } })
  revealActive()
}

export function setRecording(patch: Partial<RecordingDoc>, history = true) {
  updateDoc((doc) => (doc.recording ? { recording: { ...doc.recording, ...patch } } : {}), { history })
}

export const exportPercent = (share: number) => Math.round(share * 100)

export async function exportRecording() {
  const { doc: snapshot, activeId, exportProgress } = store.get()
  if (exportProgress !== null || !snapshot.recording) return
  const entry = getRecording(snapshot.sourceId)
  if (!entry) {
    toast('This recording is no longer available', { description: 'Record it again.' })
    return
  }
  const snapshotWithRecording = { ...snapshot, recording: snapshot.recording }
  const name = exportFileName(snapshot.fileName, 'mp4', shotFallbackName(liveShots().findIndex((record) => record.id === activeId)))
  store.set({ exportProgress: 0 })
  try {
    const [{ exportRecordingVideo }] = await Promise.all([import('./export'), backdropReady()])
    const { style, backdrop } = store.get()
    let shownPercent = 0
    const video = await exportRecordingVideo(entry, snapshotWithRecording, style, backdrop?.bitmap ?? null, (share) => {
      if (exportPercent(share) === shownPercent) return
      shownPercent = exportPercent(share)
      store.set({ exportProgress: share })
    })
    const saved = await saveVideo(video, name)
    if (!saved) return
    markSnapshotSaved(activeId, snapshot)
    toastSaved(saved, name, `${snapshot.size.width} × ${snapshot.size.height} MP4 · ${snapshot.recording.fps} fps`)
  } catch (error) {
    toastExportFailed(error)
  } finally {
    store.set({ exportProgress: null })
  }
}
