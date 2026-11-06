import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const RECORDING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const isRecordingId = (id: string) => RECORDING_ID.test(id)

export const recordingDir = (root: string, id: string) => join(root, id)

export const clearRecordings = (root: string) => rm(root, { recursive: true, force: true })
