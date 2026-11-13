import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createDraftRequests, type DraftHost } from '../src/main/draft-requests'

const MANIFEST = '{"format":"cawmera-draft","version":1}'
const TRACK = '{"version":1}'
const BUSY = 'Another draft is being saved or opened'
const NOT_LOCAL = { ok: false, reason: 'unreadable', message: 'Not a .cawmera file on a local drive' }
const noop = () => {}

/** The work takes milliseconds, but opening a freshly written file has stalled for seconds on a busy PC. */
const ON_DISK = { timeout: 30_000 }

const tempDirs: string[] = []

afterAll(() => Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3 }))))

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => (resolve = settle))
  return { promise, resolve }
}

async function setup(host: Partial<DraftHost> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cawmera-requests-'))
  tempDirs.push(dir)
  const take = randomUUID()
  const takeDir = join(dir, 'takes', take)
  await mkdir(takeDir, { recursive: true })
  await writeFile(join(takeDir, 'video.mp4'), randomBytes(3_000_000))
  const ids: string[] = []
  const fullHost = {
    recordingsRoot: join(dir, 'recordings'),
    newId: () => {
      ids.push(randomUUID())
      return ids[ids.length - 1]
    },
    takeFolder: (id: string) => (id === take ? takeDir : null),
    adoptTake: vi.fn(),
    chooseSaveTarget: vi.fn(async () => join(dir, 'saved')),
    chooseDraft: vi.fn(async (): Promise<string | null> => null),
    ...host
  }
  const files = { manifest: MANIFEST, screenshots: [{ key: 'image1', bytes: new Uint8Array(randomBytes(1000)) }], recordings: [{ key: 'take1', id: take, track: TRACK }] }
  return { dir, ids, take, files, host: fullHost, requests: createDraftRequests(fullHost), saved: join(dir, 'saved.cawmera') }
}

describe('draft requests from the renderer', ON_DISK, () => {
  it('saves where the user picks, adding the extension', async () => {
    const t = await setup()
    const progress: number[] = []
    expect(await t.requests.save(t.files, 'Launch', (share) => progress.push(share))).toEqual({ path: t.saved })
    expect(t.host.chooseSaveTarget).toHaveBeenCalledWith('Launch.cawmera')
    expect(existsSync(t.saved)).toBe(true)
    expect(progress.at(-1)).toBe(1)
    await t.requests.save(t.files, '   ', noop)
    expect(t.host.chooseSaveTarget).toHaveBeenLastCalledWith('whats-new-draft.cawmera')
  })

  it('refuses a save it couldn’t open again, or one whose take is unknown, before asking where to save', async () => {
    const t = await setup()
    const badKey = { ...t.files, screenshots: [{ key: 'Image-1', bytes: new Uint8Array(1) }] }
    const unknownTake = { ...t.files, recordings: [{ key: 'take1', id: randomUUID(), track: TRACK }] }
    expect(await t.requests.save(badKey, 'a', noop)).toEqual({ error: 'The draft key “Image-1” is invalid or repeated' })
    expect(await t.requests.save(unknownTake, 'a', noop)).toEqual({ error: 'A recording in this draft is no longer available' })
    expect(await t.requests.save({ manifest: 1 }, 'a', noop)).toEqual({ error: 'The draft’s files are malformed' })
    expect(t.host.chooseSaveTarget).not.toHaveBeenCalled()
  })

  it('runs one draft operation at a time, dialogs included', async () => {
    const saveDialog = deferred<string | null>()
    const t = await setup({ chooseSaveTarget: vi.fn(() => saveDialog.promise) })
    const saving = t.requests.save(t.files, 'a', noop)
    expect(await t.requests.save(t.files, 'b', noop)).toEqual({ error: BUSY })
    expect(await t.requests.open(null, noop)).toEqual({ ok: false, reason: 'unreadable', message: BUSY })
    expect(t.host.chooseDraft).not.toHaveBeenCalled()
    saveDialog.resolve(null)
    expect(await saving).toBeNull()

    const openDialog = deferred<string | null>()
    vi.mocked(t.host.chooseDraft).mockImplementationOnce(() => openDialog.promise)
    const opening = t.requests.open(null, noop)
    expect(await t.requests.save(t.files, 'c', noop)).toEqual({ error: BUSY })
    openDialog.resolve(null)
    expect(await opening).toBeNull()
    expect(t.host.chooseSaveTarget).toHaveBeenCalledTimes(1)
  })

  it('opens a renderer’s path only when it names a local .cawmera file, and a picked file as picked', async () => {
    const t = await setup()
    await t.requests.save(t.files, 'a', noop)
    const folder = join(t.dir, 'folder.cawmera')
    await mkdir(folder)
    for (const refused of ['saved.cawmera', folder, join(t.dir, 'missing.cawmera'), 7]) expect(await t.requests.open(refused, noop)).toEqual(NOT_LOCAL)
    expect(t.host.adoptTake).not.toHaveBeenCalled()

    const opened = await t.requests.open(t.saved, noop)
    expect(opened).toEqual({ ok: true, files: { ...t.files, recordings: [{ key: 'take1', id: t.ids[0], track: TRACK }] } })
    expect(t.host.adoptTake).toHaveBeenCalledWith(t.ids[0])

    const renamed = join(t.dir, 'draft.zip')
    await copyFile(t.saved, renamed)
    vi.mocked(t.host.chooseDraft).mockResolvedValueOnce(renamed)
    expect(await t.requests.open(null, noop)).toMatchObject({ ok: true })

    const notADraft = join(t.dir, 'notes.cawmera')
    await writeFile(notADraft, 'Not a draft')
    expect(await t.requests.open(notADraft, noop)).toEqual({ ok: false, reason: 'not-a-draft', message: 'The file isn’t a ZIP archive' })
    expect(t.host.adoptTake).toHaveBeenCalledTimes(2)
  })

  it('holds a close while a draft is written, and closes once, after the save has answered', async () => {
    const t = await setup()
    const order: string[] = []
    const close = vi.fn(() => order.push('closed'))
    expect(t.requests.holdCloseWhileWriting(close)).toBe(false)
    const held: boolean[] = []
    const saved = await t.requests
      .save(t.files, 'a', (share) => {
        if (share < 0.5 || held.length > 0) return
        held.push(t.requests.holdCloseWhileWriting(close), t.requests.holdCloseWhileWriting(close))
      })
      .then((result) => {
        order.push('saved')
        return result
      })
    expect(saved).toEqual({ path: t.saved })
    expect(held).toEqual([true, true])
    await vi.waitFor(() => expect(order).toEqual(['saved', 'closed']))
    expect(t.requests.holdCloseWhileWriting(close)).toBe(false)
  })

  it('closes once a write that failed has ended', async () => {
    const t = await setup()
    const close = vi.fn()
    let held = false
    const result = await t.requests.save(t.files, 'a', (share) => {
      if (held || share < 0.5) return
      held = t.requests.holdCloseWhileWriting(close)
      t.requests.discardUnfinishedSave()
    })
    expect(held).toBe(true)
    expect(result).toEqual({ error: expect.any(String) })
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  })

  it('holds no close while the save dialog is open or a draft is opened', async () => {
    const saveDialog = deferred<string | null>()
    const t = await setup({ chooseSaveTarget: vi.fn<DraftHost['chooseSaveTarget']>(() => saveDialog.promise) })
    const close = vi.fn()
    const cancelled = t.requests.save(t.files, 'a', noop)
    expect(t.requests.holdCloseWhileWriting(close)).toBe(false)
    saveDialog.resolve(null)
    expect(await cancelled).toBeNull()

    vi.mocked(t.host.chooseSaveTarget).mockResolvedValue(join(t.dir, 'saved'))
    await t.requests.save(t.files, 'a', noop)
    const holds: boolean[] = []
    expect(await t.requests.open(t.saved, () => holds.push(t.requests.holdCloseWhileWriting(close)))).toMatchObject({ ok: true })
    expect(holds).not.toEqual([])
    expect(holds).not.toContain(true)
    expect(close).not.toHaveBeenCalled()
  })

  it('removes the half-written file when Cawmera quits during a save, and keeps the draft it would replace', async () => {
    const t = await setup()
    await writeFile(t.saved, 'the previous draft')
    let quit = false
    const result = await t.requests.save(t.files, 'a', (share) => {
      if (quit || share < 0.5) return
      quit = true
      t.requests.discardUnfinishedSave()
    })
    expect(quit).toBe(true)
    expect(result).toEqual({ error: expect.any(String) })
    expect(existsSync(`${t.saved}.partial`)).toBe(false)
    expect(await readFile(t.saved, 'utf8')).toBe('the previous draft')
  })
})
