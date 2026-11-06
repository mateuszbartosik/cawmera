import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { parseHelperLine, startRecorder } from '../src/main/recorder-process'

const fixture = resolve(__dirname, 'fixtures/fake-recorder.mjs')
const start = (mode: string) =>
  startRecorder({ command: process.execPath, args: [fixture, mode], readyTimeoutMs: 500, stopTimeoutMs: 500 })

it('parses helper lines and ignores noise', () => {
  expect(parseHelperLine('{"type":"ready","width":1,"height":2}')).toEqual({ type: 'ready', width: 1, height: 2 })
  expect(parseHelperLine('{"type":"ready","width":0,"height":2}')).toBeNull()
  expect(parseHelperLine('{"type":"ready","width":1.5,"height":2}')).toBeNull()
  expect(parseHelperLine('{"type":"done","durationMs":"x","frames":1}')).toBeNull()
  expect(parseHelperLine('{"type":"error","code":"encoder","message":"m"}')).toEqual({ type: 'error', code: 'encoder', message: 'm' })
  expect(parseHelperLine('not json')).toBeNull()
  expect(parseHelperLine('{"type":"other"}')).toBeNull()
})

const stillPending = (ended: Promise<unknown>) =>
  Promise.race([ended, new Promise((resolve) => setTimeout(() => resolve('pending'), 200))])

it('stays warm after ready, records after begin and ends with done after stop', async () => {
  const s = await start('ready-then-done')
  expect([s.width, s.height]).toEqual([1280, 720])
  expect(await stillPending(s.ended)).toBe('pending')
  s.begin()
  expect(await stillPending(s.ended)).toBe('pending')
  s.stop()
  expect(await s.ended).toEqual({ done: { durationMs: 1000, frames: 60 } })
})

it('cancels when stopped before begin', async () => {
  const s = await start('ready-then-done')
  s.stop()
  expect(await s.ended).toEqual({ error: { code: 'internal', message: 'Stopped before recording began' } })
})

it('reports a target that goes away before begin', async () => {
  const s = await start('gone-before-start')
  expect(await s.ended).toEqual({ error: { code: 'target-gone', message: 'The window closed' } })
})

it('rejects as cancelled when aborted before ready', async () => {
  const controller = new AbortController()
  const pending = startRecorder({ command: process.execPath, args: [fixture, 'silent'], readyTimeoutMs: 5000, stopTimeoutMs: 500, signal: controller.signal })
  controller.abort()
  await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
})

it('parses a ready line split across chunks and ended with CRLF', async () => {
  const s = await start('split-lines')
  expect([s.width, s.height]).toEqual([1920, 1080])
  s.stop()
  await s.ended
})

it('ignores a ready line without a usable size', async () => {
  await expect(start('bad-ready')).rejects.toMatchObject({ code: 'timeout' })
})

it('rejects with the helper error', async () => await expect(start('error')).rejects.toEqual({ code: 'access-denied', message: 'blocked' }))

it('times out when the helper never gets ready', async () => await expect(start('silent')).rejects.toMatchObject({ code: 'timeout' }))

it('ends by itself when the recorded window goes away', async () => {
  const s = await start('exit-early')
  s.begin()
  expect(await s.ended).toEqual({ done: { durationMs: 400, frames: 24 } })
})

it('kills a helper that ignores stop', async () => {
  const s = await start('ignore-stop')
  s.begin()
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

it('gives the Media Feature Pack hint only for a silent exit before ready', async () => {
  await expect(start('crash')).rejects.toMatchObject({ message: expect.stringContaining('Media Feature Pack') })
  const s = await start('ready-then-crash')
  expect(await s.ended).toEqual({ error: { code: 'internal', message: expect.not.stringContaining('Media Feature Pack') } })
})

it('rejects with a missing command as an internal error', async () => {
  await expect(
    startRecorder({ command: resolve(__dirname, 'no-such-helper.exe'), args: [], readyTimeoutMs: 500, stopTimeoutMs: 500 })
  ).rejects.toMatchObject({ code: 'internal' })
})
