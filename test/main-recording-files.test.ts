import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { clearRecordings, isRecordingId, recordingDir } from '../src/main/recording-files'

it('clears leftover recordings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cawmera-rec-'))
  const id = '3f2a3b19-e3de-4153-9d82-95ac5c46cbd1'
  await mkdir(recordingDir(root, id), { recursive: true })
  await writeFile(join(recordingDir(root, id), 'video.mp4'), 'x')
  await clearRecordings(root)
  expect(existsSync(recordingDir(root, id))).toBe(false)
})

it('clears a root that does not exist', async () => {
  await expect(clearRecordings(join(tmpdir(), 'cawmera-rec-missing-root'))).resolves.toBeUndefined()
})

it('accepts only uuid recording ids', () => {
  expect(isRecordingId('3f2a3b19-e3de-4153-9d82-95ac5c46cbd1')).toBe(true)
  for (const bad of ['../x', '', 'C:\Windows', '3f2a3b19']) expect(isRecordingId(bad)).toBe(false)
})
