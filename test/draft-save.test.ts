import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { CawmeraBridge, DiscardAnswer, DraftFiles } from '@shared/types'
import type { Doc } from '../src/renderer/src/app/doc'
import type { ShotRecord } from '../src/renderer/src/app/store'
import type { RecordingTrack } from '../src/renderer/src/recording/track'

const mocks = vi.hoisted(() => {
  const listeners = new Set<(share: number) => void>()
  return {
    listeners,
    bridge: {
      getVersion: vi.fn(async () => '0.8.0'),
      saveDraft: vi.fn<CawmeraBridge['saveDraft']>(),
      onDraftProgress: vi.fn((listener: (share: number) => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }),
      confirmDiscard: vi.fn<CawmeraBridge['confirmDiscard']>(),
      revealFile: vi.fn(async (_path: string) => undefined)
    }
  }
})

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => 'saving') }) }))
vi.mock('../src/renderer/src/platform/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/src/platform/bridge')>()),
  bridge: mocks.bridge
}))

const { saveDraft, saveOrDiscardUnsaved } = await import('../src/renderer/src/drafts/actions')
const { DEFAULT_DOC } = await import('../src/renderer/src/app/doc')
const { isUnsaved, liveShots, registerSource, selectShot, store, updateDoc } = await import('../src/renderer/src/app/store')
const { registerRecording } = await import('../src/renderer/src/recording/registry')
const { DEFAULT_RECORDING } = await import('../src/renderer/src/recording/settings')
const { wholeTake } = await import('../src/renderer/src/recording/timemap')
const { serializeTrack } = await import('../src/renderer/src/recording/track')

interface FakeBitmap {
  tag: string
  width: number
  height: number
}

/** Encodes what was drawn where: the image's tag and the rect it covered, then the canvas size. */
class PngCanvas {
  private drawn = ''
  constructor(
    readonly width: number,
    readonly height: number
  ) {}
  getContext() {
    return {
      drawImage: (image: FakeBitmap, x: number, y: number, w = image.width, h = image.height) =>
        void (this.drawn = `${image.tag} drawn at ${x}, ${y}, ${w} × ${h}`)
    }
  }
  async convertToBlob({ type }: { type: string }) {
    return new Blob([`${type} of ${this.drawn} on ${this.width} × ${this.height}`])
  }
}
vi.stubGlobal('OffscreenCanvas', PngCanvas)

const SAVED_PATH = 'C:\\Drafts\\billing.cawmera'
const report = (share: number) => mocks.listeners.forEach((listener) => listener(share))
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const bitmap = (tag: string, width: number, height: number) => ({ tag, width, height, close: () => undefined }) as unknown as ImageBitmap
const handedOver = () => mocks.bridge.saveDraft.mock.calls[0] as [DraftFiles, string]
const unsavedIds = () => liveShots().filter(isUnsaved).map((record) => record.id)

const track: RecordingTrack = {
  kind: 'window',
  width: 1280,
  height: 720,
  fps: 60,
  durationMs: 4000,
  scale: 1,
  cursor: [{ t: 0, x: 10, y: 20, shape: 'arrow' }],
  clicks: [{ t: 1000, x: 10, y: 20, button: 'left', up: 1100 }]
}
registerRecording({ id: 'take-1', name: 'Billing', track, poster: null })
registerSource({ id: 'image-a', bitmap: bitmap('image-a', 800, 600), width: 800, height: 600, name: 'billing.png', origin: 'file', detected: 1 })

const empty: Doc = { ...DEFAULT_DOC }
const screenshot: Doc = { ...DEFAULT_DOC, sourceId: 'image-a' }
const recording: Doc = {
  ...DEFAULT_DOC,
  sourceId: 'take-1',
  size: { width: 1920, height: 1080 },
  fileName: 'Billing costs',
  recording: { ...DEFAULT_RECORDING, trim: { start: 0, end: 4000 }, pieces: wholeTake(4000), zooms: null }
}

function setCanvas(docs: Doc[], active = 0) {
  const shots: ShotRecord[] = docs.map((doc, index) => ({ id: `shot-${index}`, doc, past: [], future: [], savedDoc: null, draftDoc: null }))
  const { id, doc } = shots[active]
  store.set({ shots, activeId: id, doc, past: [], future: [], savedDoc: null, draftDoc: null, selection: [], shotSelection: [], timelineSelection: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listeners.clear()
  mocks.bridge.saveDraft.mockResolvedValue({ path: SAVED_PATH })
  setCanvas([empty, screenshot, recording, screenshot], 2)
})

describe('saved state', () => {
  it('counts a shot saved in a draft as saved until it changes', () => {
    const shot: ShotRecord = { id: 'shot', doc: screenshot, past: [], future: [], savedDoc: null, draftDoc: null }
    const record = { ...shot, savedDoc: null, draftDoc: shot.doc }
    expect(isUnsaved(record)).toBe(false)
    expect(isUnsaved({ ...record, doc: { ...record.doc, angle: 10 } })).toBe(true)
  })
})

describe('saveDraft', () => {
  it('hands over the manifest, each screenshot as a PNG by key, and each recording by key and take id', async () => {
    expect(await saveDraft()).toBe(true)
    const [files, suggestedName] = handedOver()
    const manifest = JSON.parse(files.manifest)
    expect(manifest).toMatchObject({ format: 'cawmera-draft', version: 1, savedBy: '0.8.0', active: 2 })
    expect(manifest.shots.map((shot: { kind: string; key?: string }) => [shot.kind, shot.key])).toEqual([
      ['empty', undefined],
      ['screenshot', 'image1'],
      ['recording', 'take1'],
      ['screenshot', 'image1']
    ])
    expect(manifest.shots[2].name).toBe('Billing')
    expect(files.screenshots.map(({ key, bytes }) => [key, text(bytes)])).toEqual([['image1', 'image/png of image-a drawn at 0, 0, 800 × 600 on 800 × 600']])
    expect(files.recordings).toEqual([{ key: 'take1', id: 'take-1', track: serializeTrack(track) }])
    expect(suggestedName).toBe('billing-costs.cawmera')
  })

  it('files a screenshot and a take that share an id under keys of their own kind', async () => {
    registerSource({ id: 'shared', bitmap: bitmap('shared', 10, 20), width: 10, height: 20, name: 'shared.png', origin: 'paste', detected: 1 })
    registerRecording({ id: 'shared', name: 'Shared', track, poster: null })
    setCanvas([{ ...recording, sourceId: 'shared' }, { ...screenshot, sourceId: 'shared' }])
    await saveDraft()
    const [files] = handedOver()
    expect(files.screenshots.map(({ key, bytes }) => [key, text(bytes)])).toEqual([['image1', 'image/png of shared drawn at 0, 0, 10 × 20 on 10 × 20']])
    expect(files.recordings.map(({ key, id }) => [key, id])).toEqual([['take1', 'shared']])
  })

  it('shows the progress while the draft is written, then names the saved file', async () => {
    mocks.bridge.saveDraft.mockImplementation(async () => {
      report(0)
      report(0.42)
      report(1)
      return { path: SAVED_PATH }
    })
    await saveDraft()
    report(0.5)
    expect(vi.mocked(toast.loading).mock.calls).toEqual([
      ['Saving draft… 0%', { id: undefined }],
      ['Saving draft… 42%', { id: 'saving' }],
      ['Saving draft… 100%', { id: 'saving' }]
    ])
    expect(toast.success).toHaveBeenCalledWith('Draft saved', expect.objectContaining({ id: 'saving', description: 'billing.cawmera' }))
    const action = vi.mocked(toast.success).mock.calls[0][1]?.action as { label: string; onClick: () => void }
    expect(action.label).toBe('Show in folder')
    action.onClick()
    expect(mocks.bridge.revealFile).toHaveBeenCalledWith(SAVED_PATH)
  })

  it('gives each save a toast of its own', async () => {
    mocks.bridge.saveDraft.mockImplementation(async () => {
      report(0.5)
      return { path: SAVED_PATH }
    })
    await saveDraft()
    await saveDraft()
    expect(vi.mocked(toast.loading).mock.calls.map(([, data]) => data?.id)).toEqual([undefined, undefined])
  })

  it('counts every shot as saved once the draft is written', async () => {
    expect(unsavedIds()).toEqual(['shot-1', 'shot-2', 'shot-3'])
    await saveDraft()
    expect(liveShots().every((record) => record.draftDoc === record.doc)).toBe(true)
    expect(unsavedIds()).toEqual([])
  })

  it('marks the shots saved even when another shot became active while the draft was written', async () => {
    mocks.bridge.saveDraft.mockImplementation(async () => {
      selectShot('shot-1')
      return { path: SAVED_PATH }
    })
    await saveDraft()
    expect(unsavedIds()).toEqual([])
  })

  it('keeps an edit made while the draft was written as unsaved work', async () => {
    mocks.bridge.saveDraft.mockImplementation(async () => {
      updateDoc({ angle: 10 })
      return { path: SAVED_PATH }
    })
    await saveDraft()
    expect(unsavedIds()).toEqual(['shot-2'])
  })

  it.each([
    ['is cancelled', () => Promise.resolve(null), []],
    ['is refused', () => Promise.resolve({ error: 'Another draft is being saved or opened' }), ['Another draft is being saved or opened']],
    ['fails', () => Promise.reject(new Error('Disk full')), ['Disk full']]
  ])('changes nothing when the save %s, and names any problem', async (_, outcome, problems) => {
    mocks.bridge.saveDraft.mockImplementation(outcome)
    const before = store.get()
    expect(await saveDraft()).toBe(false)
    expect(store.get().shots).toBe(before.shots)
    expect(liveShots().map((record) => record.draftDoc)).toEqual([null, null, null, null])
    expect(unsavedIds()).toEqual(['shot-1', 'shot-2', 'shot-3'])
    expect(toast.success).not.toHaveBeenCalled()
    expect(vi.mocked(toast.error).mock.calls.map(([title, data]) => [title, data?.description])).toEqual(
      problems.map((problem) => ['The draft couldn’t be saved', problem])
    )
  })

  it('hands over nothing when a recording’s take is gone', async () => {
    setCanvas([{ ...recording, sourceId: 'gone' }])
    expect(await saveDraft()).toBe(false)
    expect(mocks.bridge.saveDraft).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('The draft couldn’t be saved', expect.objectContaining({ description: 'A recording in this draft is no longer available' }))
  })

  it('runs one save at a time and keeps Save draft disabled until it ends', async () => {
    let finish: (result: { path: string }) => void = () => undefined
    mocks.bridge.saveDraft.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const first = saveDraft()
    const second = saveDraft()
    expect(store.get().draftBusy).toBe(true)
    await vi.waitFor(() => expect(mocks.bridge.saveDraft).toHaveBeenCalledTimes(1))
    finish({ path: SAVED_PATH })
    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(mocks.bridge.saveDraft).toHaveBeenCalledTimes(1)
    expect(store.get().draftBusy).toBe(false)
  })
})

describe('closing with unsaved work', () => {
  it('closes without asking when nothing is unsaved', async () => {
    setCanvas([empty])
    expect(await saveOrDiscardUnsaved('close')).toBe(true)
    expect(mocks.bridge.confirmDiscard).not.toHaveBeenCalled()
  })

  it('asks with the count of unsaved shots, then discards or keeps working as chosen', async () => {
    mocks.bridge.confirmDiscard.mockResolvedValue('discard')
    expect(await saveOrDiscardUnsaved('close')).toBe(true)
    expect(mocks.bridge.confirmDiscard).toHaveBeenCalledWith(3, 'close')
    mocks.bridge.confirmDiscard.mockResolvedValue('keep')
    expect(await saveOrDiscardUnsaved('close')).toBe(false)
    expect(mocks.bridge.saveDraft).not.toHaveBeenCalled()
  })

  it('closes after Save draft only once the draft is saved', async () => {
    mocks.bridge.confirmDiscard.mockResolvedValue('save')
    mocks.bridge.saveDraft.mockResolvedValue(null)
    expect(await saveOrDiscardUnsaved('close')).toBe(false)
    mocks.bridge.saveDraft.mockResolvedValue({ error: 'Disk full' })
    expect(await saveOrDiscardUnsaved('close')).toBe(false)
    expect(unsavedIds()).toEqual(['shot-1', 'shot-2', 'shot-3'])
    mocks.bridge.saveDraft.mockResolvedValue({ path: SAVED_PATH })
    expect(await saveOrDiscardUnsaved('close')).toBe(true)
  })

  it('waits for a save already running instead of starting another', async () => {
    let finish: (result: { path: string }) => void = () => undefined
    mocks.bridge.saveDraft.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    mocks.bridge.confirmDiscard.mockResolvedValue('save')
    const running = saveDraft()
    const closing = saveOrDiscardUnsaved('close')
    await vi.waitFor(() => {
      expect(mocks.bridge.confirmDiscard).toHaveBeenCalledTimes(1)
      expect(mocks.bridge.saveDraft).toHaveBeenCalledTimes(1)
    })
    finish({ path: SAVED_PATH })
    expect(await Promise.all([running, closing])).toEqual([true, true])
    expect(mocks.bridge.saveDraft).toHaveBeenCalledTimes(1)
  })

  it('starts no second save when the running one saved everything while the dialog was up', async () => {
    let finish: (result: { path: string }) => void = () => undefined
    mocks.bridge.saveDraft.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    let answer: (choice: DiscardAnswer) => void = () => undefined
    mocks.bridge.confirmDiscard.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    const running = saveDraft()
    const closing = saveOrDiscardUnsaved('close')
    await vi.waitFor(() => {
      expect(mocks.bridge.confirmDiscard).toHaveBeenCalledTimes(1)
      expect(mocks.bridge.saveDraft).toHaveBeenCalledTimes(1)
    })
    finish({ path: SAVED_PATH })
    expect(await running).toBe(true)
    mocks.bridge.saveDraft.mockResolvedValue({ path: SAVED_PATH })
    answer('save')
    expect(await closing).toBe(true)
    expect(mocks.bridge.saveDraft).toHaveBeenCalledTimes(1)
  })

  it('stays open when work changed while the draft was saved', async () => {
    mocks.bridge.confirmDiscard.mockResolvedValue('save')
    mocks.bridge.saveDraft.mockImplementation(async () => {
      updateDoc({ angle: 10 })
      return { path: SAVED_PATH }
    })
    expect(await saveOrDiscardUnsaved('close')).toBe(false)
  })
})
