import { toast } from 'sonner'
import type { CaptureSource, RecordingError, RecordingFinished } from '@shared/types'
import { recordingUrl } from '@shared/media'
import { countdown, interruptCountdown, resetCancellation } from '../app/actions'
import { exportFileName, type Doc } from '../app/doc'
import { addShot, backdropReady, emptyDoc, liveShots, markSaved, store, updateDoc } from '../app/store'
import { revealActive } from '../canvas/view'
import { bridge, saveVideo } from '../platform/bridge'
import { exportRecordingVideo } from './export'
import { getRecording, registerRecording } from './registry'
import { runStartFlow } from './start-flow'
import { RECORDING_SIZE, recordingDocFor, type RecordingDoc } from './settings'
import { parseTrack } from './track'
import { autoZooms } from './zooms'

const POSTER_TIMEOUT_MS = 5000
const DEFAULT_RECORDING_NAME = 'Recording'

export const PRIVACY_SETTING_PATH = 'Settings > Privacy & security > Screenshots and screen recording'

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
        description: `In ${PRIVACY_SETTING_PATH}, allow desktop apps to capture the screen, then try again.`
      })
      return
    case 'unsupported':
      toast.error('Recording needs Windows 10 version 2004 or newer')
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
  const { delay, doc, style } = store.get()
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
      countdown:
        delay > 0
          ? {
              show: () => target.showCountdown({ displayId: source.displayId, seconds: delay, color: doc.lightColor ?? style.glow }),
              run: async () => {
                const finished = await countdown(delay, (remaining) => {
                  target.tickCountdown(remaining)
                  target.setProgress((delay - remaining + 1) / (delay + 1))
                })
                // Cancel already set the phase to idle; stay busy until the cleanup is done.
                if (!finished) store.set({ capture: { phase: 'grabbing', remaining: 0 } })
                return finished
              },
              interrupt: interruptCountdown,
              hide: () => target.hideCountdown()
            }
          : null,
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

function grabPoster(id: string, atMs: number): Promise<ImageBitmap | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    let settled = false
    const finish = (poster: ImageBitmap | null) => {
      if (settled) return poster?.close()
      settled = true
      clearTimeout(timer)
      video.onerror = video.onloadeddata = video.onseeked = null
      video.removeAttribute('src')
      video.load()
      resolve(poster)
    }
    const grab = () => createImageBitmap(video).then(finish, () => finish(null))
    const timer = setTimeout(() => finish(null), POSTER_TIMEOUT_MS)
    video.muted = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.onerror = () => finish(null)
    video.onloadeddata = () => {
      const at = atMs / 1000
      // Seeking to the time the video is already at fires no `seeked`.
      if (video.currentTime === at) return void grab()
      video.onseeked = () => void grab()
      video.currentTime = at
    }
    video.src = recordingUrl(id)
  })
}

export async function finishRecording(result: RecordingFinished) {
  try {
    const track = parseTrack(JSON.parse(result.track))
    const settings = recordingDocFor(track, lastRecordingDoc()?.recording ?? null)
    const poster = await grabPoster(result.id, settings.trim.start)
    registerRecording({
      id: result.id,
      name: recordingName,
      track,
      zooms: autoZooms(track.clicks, { width: track.width, height: track.height }, track.durationMs),
      poster
    })
    addRecordingShot(result.id, settings)
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

const percent = (share: number) => Math.round(share * 100)

export async function exportRecording() {
  const { doc, activeId, exportProgress } = store.get()
  if (exportProgress !== null || !doc.recording) return
  const entry = getRecording(doc.sourceId)
  if (!entry) {
    toast('This recording is no longer available', { description: 'Record it again.' })
    return
  }
  const recordingDoc = { ...doc, recording: doc.recording }
  const name = exportFileName(doc.fileName, 'mp4', `whats-new-shot-${liveShots().findIndex((record) => record.id === activeId) + 1}`)
  store.set({ exportProgress: 0 })
  try {
    await backdropReady()
    const { style, backdrop } = store.get()
    let shown = 0
    const video = await exportRecordingVideo(entry, recordingDoc, style, backdrop?.bitmap ?? null, (share) => {
      if (percent(share) !== shown) store.set({ exportProgress: share })
      shown = percent(share)
    })
    const saved = await saveVideo(video, name)
    if (!saved) return
    markSaved([activeId])
    const description = `${doc.size.width} × ${doc.size.height} MP4 · ${doc.recording.fps} fps`
    const path = saved.path
    if (path && bridge) {
      toast.success(`Saved ${path.split(/[\/]/).pop()}`, {
        description,
        action: { label: 'Show in folder', onClick: () => void bridge?.revealFile(path) }
      })
    } else {
      toast.success(`Downloaded ${name}`, { description })
    }
  } catch (error) {
    toast.error('Export failed', { description: error instanceof Error ? error.message : String(error) })
  } finally {
    store.set({ exportProgress: null })
  }
}
