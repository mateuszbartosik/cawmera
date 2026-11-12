import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const RECORDING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const isRecordingId = (id: string) => RECORDING_ID.test(id)

export function recordingDir(root: string, id: string) {
  if (!isRecordingId(id)) throw new Error('Not a recording id')
  return join(root, id)
}

export const removeRecording = (root: string, id: string) => rm(recordingDir(root, id), { recursive: true, force: true, maxRetries: 3 })

export const clearRecordings = (root: string) => rm(root, { recursive: true, force: true })
