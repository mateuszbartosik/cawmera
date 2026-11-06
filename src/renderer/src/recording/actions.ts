import { toast } from 'sonner'
import type { CaptureSource, RecordingError, RecordingFinished } from '@shared/types'
import { recordingUrl } from '@shared/media'
import { countdown, interruptCountdown, resetCancellation } from '../app/actions'
import type { Doc } from '../app/doc'
import { addShot, emptyDoc, liveShots, store, updateDoc } from '../app/store'
import { revealActive } from '../canvas/view'
import { bridge } from '../platform/bridge'
import { registerRecording } from './registry'
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

/**
 * The helper warms up while the countdown runs, so the take starts with the countdown's last
 * second instead of losing its first two.
 */
export async function recordSource(source: CaptureSource) {
  if (!bridge) return
  const { delay, doc, style } = store.get()
  resetCancellation()
  recordingName = source.name
  let countdownShown = false
  const start: { error: RecordingError | null } = { error: null }
  let recording = false
  try {
    store.set({ capture: { phase: 'grabbing', remaining: 0 } })
    await bridge.hideWindow()
    const warmedUp = bridge.startRecording({ sourceId: source.id, displayId: source.displayId }).then((error) => {
      if (error) {
        start.error = error
        interruptCountdown()
      }
    })
    let counted = true
    if (delay > 0) {
      countdownShown = true
      await bridge.showCountdown({ displayId: source.displayId, seconds: delay, color: doc.lightColor ?? style.glow })
      counted = await countdown(delay, (remaining) => {
        bridge?.tickCountdown(remaining)
        bridge?.setProgress((delay - remaining + 1) / (delay + 1))
      })
    }
    if (!counted && !start.error) await bridge.stopRecording()
    await warmedUp
    if (countdownShown) {
      // It must be off the screen before the take begins, or it would be in the video.
      await bridge.hideCountdown()
      countdownShown = false
    }
    if (start.error) return toastFor(start.error)
    if (!counted) return
    const beginError = await bridge.beginRecording()
    if (beginError) return toastFor(beginError)
    recording = true
    store.set({ capture: { phase: 'recording', remaining: 0 } })
  } catch (error) {
    console.error('Recording failed', error)
    toast.error('Recording failed', { description: error instanceof Error ? error.message : String(error) })
  } finally {
    if (countdownShown) await bridge.hideCountdown()
    if (!recording) {
      idle()
      await bridge.restoreWindow()
    }
  }
}

/** Reports a take that broke after it began. */
export async function recordingFailed(error: RecordingError) {
  idle()
  await bridge?.restoreWindow()
  toastFor(error)
}

function grabPoster(id: string, atMs: number): Promise<ImageBitmap | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const finish = (poster: ImageBitmap | null) => {
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      resolve(poster)
    }
    const timer = setTimeout(() => finish(null), POSTER_TIMEOUT_MS)
    video.muted = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.onerror = () => finish(null)
    video.onloadeddata = () => {
      video.onseeked = () => createImageBitmap(video).then(finish, () => finish(null))
      video.currentTime = atMs / 1000
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
