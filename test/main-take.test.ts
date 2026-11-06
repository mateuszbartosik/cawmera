import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RecorderResult, RecorderSession } from '../src/main/recorder-process'
import { createTakeLifecycle, STOP_SHORTCUT, type TakeHost } from '../src/main/take'
import type { RecordingError, RecordingFinished, RecordingStartRequest } from '../src/shared/types'

const request: RecordingStartRequest = { sourceId: 'window:42:0', displayId: null }
const cancelled: RecordingError = { code: 'cancelled', message: 'Recording cancelled' }
const TRACK = '{"version":1}'
const DONE: RecorderResult = { done: { durationMs: 1000, frames: 60 } }

class FakeSession implements RecorderSession {
  width = 1280
  height = 720
  readonly calls: string[] = []
  readonly ended: Promise<RecorderResult>
  end: (result: RecorderResult) => void = () => {}
  /** Like the helper: a stop before begin cancels, a stop after it leaves a track. */
  onStop = async () => {
    if (!this.calls.includes('begin')) return this.end({ error: { code: 'internal', message: 'Stopped before recording began' } })
    await this.writeTrack()
    this.end(DONE)
  }

  constructor(readonly dir: string) {
    this.ended = new Promise((resolve) => (this.end = resolve))
  }

  writeTrack = () => writeFile(join(this.dir, 'track.json'), TRACK)

  begin() {
    this.calls.push('begin')
  }

  stop() {
    this.calls.push('stop')
    void this.onStop()
  }
}

function fakeHelper() {
  const warming: { ready: () => FakeSession; fail: (error: RecordingError) => void }[] = []
  const startHelper = (args: string[], signal: AbortSignal) =>
    new Promise<RecorderSession>((resolve, reject) => {
      if (signal.aborted) return reject(cancelled)
      signal.addEventListener('abort', () => reject(cancelled), { once: true })
      const dir = args[args.indexOf('--out') + 1]
      warming.push({
        ready: () => {
          const session = new FakeSession(dir)
          resolve(session)
          return session
        },
        fail: reject
      })
    })
  return { startHelper, warming }
}

function fakeWindow() {
  const restoreListeners = new Set<() => void>()
  const sent: unknown[][] = []
  return {
    minimized: true,
    sent,
    restoreListeners,
    isMinimized() {
      return this.minimized
    },
    on(_event: 'restore', listener: () => void) {
      restoreListeners.add(listener)
    },
    removeListener(_event: 'restore', listener: () => void) {
      restoreListeners.delete(listener)
    },
    restore() {
      this.minimized = false
      for (const listener of [...restoreListeners]) listener()
    },
    webContents: { send: (channel: string, ...payload: unknown[]) => void sent.push([channel, ...payload]) }
  }
}

function fakeShortcuts() {
  let onPress: (() => void) | null = null
  return {
    register: vi.fn((_accelerator: string, callback: () => void) => {
      onPress = callback
      return true
    }),
    unregister: vi.fn(() => {
      onPress = null
    }),
    press: () => onPress?.(),
    isRegistered: () => onPress !== null
  }
}

async function setup(host: Partial<TakeHost> = {}) {
  const recordingsRoot = join(await mkdtemp(join(tmpdir(), 'cawmera-take-')), 'recordings')
  const helper = fakeHelper()
  const window = fakeWindow()
  const shortcuts = fakeShortcuts()
  const takes = createTakeLifecycle({
    recordingsRoot,
    support: () => ({ ok: true }),
    targetArgs: () => ['--window', '42'],
    startHelper: helper.startHelper,
    window: () => window,
    shortcuts,
    beginDeadlineMs: 60_000,
    ...host
  })
  return { recordingsRoot, helper, window, shortcuts, takes }
}

type Setup = Awaited<ReturnType<typeof setup>>

async function startWarming({ takes, helper }: Setup) {
  const started = takes.start(request)
  await vi.waitFor(() => expect(helper.warming).toHaveLength(1))
  return { started }
}

async function warmUp(t: Setup) {
  const { started } = await startWarming(t)
  const session = t.helper.warming[0].ready()
  expect(await started).toBeNull()
  return session
}

const takeFolders = async (root: string) => (existsSync(root) ? await readdir(root) : [])

const noFoldersLeft = (t: Setup) => vi.waitFor(async () => expect(await takeFolders(t.recordingsRoot)).toEqual([]))

const sentOn = ({ window }: Setup, channel: string) => window.sent.filter(([name]) => name === channel).map(([, payload]) => payload)

describe('take lifecycle', () => {
  it('warms up, records once begun and finishes into a video only it can serve', async () => {
    const t = await setup()
    const session = await warmUp(t)
    expect(session.calls).toEqual([])
    expect(t.takes.begin()).toBeNull()
    expect(session.calls).toEqual(['begin'])
    expect(t.shortcuts.register).toHaveBeenCalledWith(STOP_SHORTCUT, expect.any(Function))
    t.shortcuts.press()
    await vi.waitFor(() => expect(sentOn(t, 'recording:finished')).toHaveLength(1))
    const [finished] = sentOn(t, 'recording:finished') as RecordingFinished[]
    expect(finished).toEqual({ id: expect.any(String), stoppedBy: 'shortcut', track: TRACK })
    expect(t.takes.videoFile(finished.id)).toBe(join(t.recordingsRoot, finished.id, 'video.mp4'))
    expect(t.takes.videoFile(randomUUID())).toBeNull()
    expect(t.shortcuts.isRegistered()).toBe(false)
    expect(t.window.restoreListeners.size).toBe(0)
  })

  it('refuses a second take while one runs', async () => {
    const t = await setup()
    await warmUp(t)
    expect(await t.takes.start(request)).toEqual({ code: 'internal', message: 'A recording is already running' })
  })

  it('keeps the reason recording is unavailable', async () => {
    const t = await setup({ support: () => ({ ok: false, reason: 'helper-missing' }) })
    expect(await t.takes.start(request)).toMatchObject({ code: 'unsupported', reason: 'helper-missing' })
    expect(t.helper.warming).toEqual([])
  })

  it('reports a source that is gone without starting the helper', async () => {
    const t = await setup({ targetArgs: () => null })
    expect(await t.takes.start(request)).toMatchObject({ code: 'target-gone' })
    expect(t.helper.warming).toEqual([])
  })

  it('reports a helper that fails while warming up and leaves nothing behind', async () => {
    const t = await setup()
    const { started } = await startWarming(t)
    const denied: RecordingError = { code: 'access-denied', message: 'blocked' }
    t.helper.warming[0].fail(denied)
    expect(await started).toEqual(denied)
    expect(await takeFolders(t.recordingsRoot)).toEqual([])
    expect(t.window.restoreListeners.size).toBe(0)
  })

  describe('cancelling before it begins', () => {
    it('resolves a start that is still warming up as cancelled and removes its folder', async () => {
      const t = await setup()
      const { started } = await startWarming(t)
      t.takes.stop('shortcut')
      expect(await started).toEqual(cancelled)
      expect(await takeFolders(t.recordingsRoot)).toEqual([])
      expect(t.window.restoreListeners.size).toBe(0)
      expect(t.takes.begin()).toEqual(cancelled)
      expect(t.window.sent).toEqual([])
    })

    it('stops a warm helper, removes its folder and sends nothing', async () => {
      const t = await setup()
      const session = await warmUp(t)
      t.takes.stop('shortcut')
      expect(session.calls).toEqual(['stop'])
      await noFoldersLeft(t)
      expect(t.window.restoreListeners.size).toBe(0)
      expect(t.window.sent).toEqual([])
    })

    it('answers a later begin with cancelled, without a start line or a shortcut', async () => {
      const t = await setup()
      const session = await warmUp(t)
      t.takes.stop('shortcut')
      await noFoldersLeft(t)
      expect(t.takes.begin()).toEqual(cancelled)
      expect(session.calls).toEqual(['stop'])
      expect(t.shortcuts.register).not.toHaveBeenCalled()
    })

    it('answers a begin with cancelled while the cancelled helper is still stopping', async () => {
      const t = await setup()
      const session = await warmUp(t)
      session.onStop = async () => {}
      t.takes.stop('shortcut')
      expect(t.takes.begin()).toEqual(cancelled)
      expect(session.calls).toEqual(['stop'])
      expect(t.shortcuts.register).not.toHaveBeenCalled()
    })

    it('reports a source that went away during the countdown when beginning', async () => {
      const t = await setup()
      const session = await warmUp(t)
      const gone: RecordingError = { code: 'target-gone', message: 'The window closed' }
      session.end({ error: gone })
      await noFoldersLeft(t)
      expect(t.takes.begin()).toEqual(gone)
      expect(session.calls).toEqual([])
      expect(t.shortcuts.register).not.toHaveBeenCalled()
      expect(t.window.sent).toEqual([])
    })
  })

  describe('after it begins', () => {
    it('finishes a take whose source went away while recording', async () => {
      const t = await setup()
      const session = await warmUp(t)
      t.takes.begin()
      await session.writeTrack()
      session.end(DONE)
      await vi.waitFor(() => expect(sentOn(t, 'recording:finished')).toEqual([expect.objectContaining({ stoppedBy: 'target-gone' })]))
      expect(t.shortcuts.isRegistered()).toBe(false)
    })

    it('reports a take that breaks while recording and removes its folder', async () => {
      const t = await setup()
      const session = await warmUp(t)
      t.takes.begin()
      const encoder: RecordingError = { code: 'encoder', message: 'The encoder stopped' }
      session.end({ error: encoder })
      await noFoldersLeft(t)
      expect(sentOn(t, 'recording:failed')).toEqual([encoder])
      expect(sentOn(t, 'recording:finished')).toEqual([])
    })

    it('reports a take whose cursor track is missing', async () => {
      const t = await setup()
      const session = await warmUp(t)
      t.takes.begin()
      session.end(DONE)
      await vi.waitFor(() => expect(sentOn(t, 'recording:failed')).toEqual([expect.objectContaining({ code: 'internal' })]))
      expect(sentOn(t, 'recording:finished')).toEqual([])
    })
  })

  describe('quitting', () => {
    it('cancels a take that is still warming up, then clears every recording', async () => {
      const t = await setup()
      const { started } = await startWarming(t)
      await t.takes.quit()
      expect(await started).toEqual(cancelled)
      expect(existsSync(t.recordingsRoot)).toBe(false)
    })

    it('cancels a warm take, then clears every recording', async () => {
      const t = await setup()
      const session = await warmUp(t)
      await t.takes.quit()
      expect(session.calls).toEqual(['stop'])
      expect(existsSync(t.recordingsRoot)).toBe(false)
      expect(t.window.sent).toEqual([])
    })

    it('stops a recording take and clears it only once the helper is done', async () => {
      const t = await setup()
      const session = await warmUp(t)
      t.takes.begin()
      session.onStop = async () => {}
      let quit = false
      const quitting = t.takes.quit().then(() => (quit = true))
      expect(session.calls).toEqual(['begin', 'stop'])
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(quit).toBe(false)
      expect(await takeFolders(t.recordingsRoot)).toHaveLength(1)
      await session.writeTrack()
      session.end(DONE)
      await quitting
      expect(existsSync(t.recordingsRoot)).toBe(false)
    })
  })

  describe('closing Cawmera', () => {
    it('stops a recording take into a shot instead of closing, and only a recording one', async () => {
      const t = await setup()
      expect(t.takes.stopLiveTake()).toBe(false)
      const session = await warmUp(t)
      expect(t.takes.stopLiveTake()).toBe(false)
      expect(session.calls).toEqual([])
      t.takes.begin()
      session.onStop = async () => {}
      expect(t.takes.stopLiveTake()).toBe(true)
      expect(t.takes.stopLiveTake()).toBe(true)
      expect(session.calls).toEqual(['begin', 'stop'])
      await session.writeTrack()
      session.end(DONE)
      await vi.waitFor(() => expect(sentOn(t, 'recording:finished')).toEqual([expect.objectContaining({ stoppedBy: 'window' })]))
      expect(t.takes.stopLiveTake()).toBe(false)
    })
  })

  describe('restoring Cawmera', () => {
    it('cancels the take when Cawmera is back on screen at begin', async () => {
      const t = await setup()
      const session = await warmUp(t)
      t.window.minimized = false
      expect(t.takes.begin()).toEqual(cancelled)
      expect(session.calls).toEqual(['stop'])
      expect(t.shortcuts.register).not.toHaveBeenCalled()
      await noFoldersLeft(t)
      expect(t.window.sent).toEqual([])
    })

    it('cancels a warm take at once during the countdown and ends the countdown', async () => {
      const t = await setup()
      const session = await warmUp(t)
      t.window.restore()
      expect(session.calls).toEqual(['stop'])
      expect(t.window.sent).toEqual([['capture-cancel']])
      expect(t.takes.begin()).toEqual(cancelled)
      await noFoldersLeft(t)
    })

    it('cancels a take that is still warming up', async () => {
      const t = await setup()
      const { started } = await startWarming(t)
      t.window.restore()
      expect(await started).toEqual(cancelled)
      expect(t.window.sent).toEqual([['capture-cancel']])
      expect(await takeFolders(t.recordingsRoot)).toEqual([])
    })

    it('ignores the restore that follows its own cancel', async () => {
      const t = await setup()
      const session = await warmUp(t)
      session.onStop = async () => {}
      t.takes.stop('shortcut')
      t.window.restore()
      expect(t.window.sent).toEqual([])
    })

    it('stops a recording take', async () => {
      const t = await setup()
      await warmUp(t)
      t.takes.begin()
      t.window.restore()
      await vi.waitFor(() => expect(sentOn(t, 'recording:finished')).toEqual([expect.objectContaining({ stoppedBy: 'window' })]))
      expect(sentOn(t, 'capture-cancel')).toEqual([])
    })
  })

  describe('a take that is never begun', () => {
    it('is cancelled once the begin deadline passes', async () => {
      const t = await setup({ beginDeadlineMs: 10 })
      const session = await warmUp(t)
      await vi.waitFor(() => expect(session.calls).toEqual(['stop']))
      await noFoldersLeft(t)
      expect(t.takes.begin()).toEqual(cancelled)
    })

    it('keeps recording when it began before the deadline', async () => {
      const t = await setup({ beginDeadlineMs: 10 })
      const session = await warmUp(t)
      t.takes.begin()
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(session.calls).toEqual(['begin'])
    })

    it('is cancelled when its page goes away', async () => {
      const t = await setup()
      const session = await warmUp(t)
      t.takes.cancelWarmTake()
      expect(session.calls).toEqual(['stop'])
      await noFoldersLeft(t)
    })

    it('leaves a recording take running when its page goes away', async () => {
      const t = await setup()
      const session = await warmUp(t)
      t.takes.begin()
      t.takes.cancelWarmTake()
      expect(session.calls).toEqual(['begin'])
      expect(t.takes.stopLiveTake()).toBe(true)
    })
  })
})
