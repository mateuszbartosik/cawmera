import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { clearRecordings, isRecordingId, recordingDir, removeRecording } from '../src/main/recording-files'

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
  for (const bad of ['../x', '', 'C:\\Windows', '3f2a3b19']) expect(isRecordingId(bad)).toBe(false)
})

it('refuses to build a path from anything but a recording id', () => {
  expect(() => recordingDir('root', '../x')).toThrow()
  expect(() => recordingDir('root', 'C:\\Windows')).toThrow()
})

it('removes one recording and keeps the others', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cawmera-rec-'))
  const first = '3f2a3b19-e3de-4153-9d82-95ac5c46cbd1'
  const second = '4f2a3b19-e3de-4153-9d82-95ac5c46cbd2'
  for (const id of [first, second]) await mkdir(recordingDir(root, id), { recursive: true })
  await removeRecording(root, first)
  expect(existsSync(recordingDir(root, first))).toBe(false)
  expect(existsSync(recordingDir(root, second))).toBe(true)
})
