import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { parseHelperLine, startRecorder } from '../src/main/recorder-process'

const fixture = resolve(__dirname, 'fixtures/fake-recorder.mjs')
const start = (mode: string) =>
  startRecorder({ command: process.execPath, args: [fixture, mode], readyTimeoutMs: 500, stopTimeoutMs: 500 })

it('parses helper lines and ignores noise', () => {
  expect(parseHelperLine('{"type":"ready","width":1,"height":2}')).toEqual({ type: 'ready', width: 1, height: 2 })
  expect(parseHelperLine('not json')).toBeNull()
  expect(parseHelperLine('{"type":"other"}')).toBeNull()
})

it('resolves on ready and ends with done after stop', async () => {
  const s = await start('ready-then-done')
  expect([s.width, s.height]).toEqual([1280, 720])
  s.stop()
  expect(await s.ended).toEqual({ done: { durationMs: 1000, frames: 60 } })
})

it('rejects with the helper error', async () => await expect(start('error')).rejects.toEqual({ code: 'access-denied', message: 'blocked' }))

it('times out when the helper never gets ready', async () => await expect(start('silent')).rejects.toMatchObject({ code: 'timeout' }))

it('ends by itself when the recorded window goes away', async () => {
  const s = await start('exit-early')
  expect(await s.ended).toEqual({ done: { durationMs: 400, frames: 24 } })
})

it('kills a helper that ignores stop', async () => {
  const s = await start('ignore-stop')
  s.stop()
  expect(await s.ended).toMatchObject({ error: { code: 'timeout' } })
})

it('rejects with an internal error when the helper dies before ready without a word', async () => {
  await expect(start('crash')).rejects.toMatchObject({ code: 'internal' })
})

it('ends with an internal error when the helper dies after ready without a word', async () => {
  const s = await start('ready-then-crash')
  expect(await s.ended).toMatchObject({ error: { code: 'internal' } })
})

it('rejects with a missing command as an internal error', async () => {
  await expect(
    startRecorder({ command: resolve(__dirname, 'no-such-helper.exe'), args: [], readyTimeoutMs: 500, stopTimeoutMs: 500 })
  ).rejects.toMatchObject({ code: 'internal' })
})
