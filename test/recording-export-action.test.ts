import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { RecordingEntry } from '../src/renderer/src/recording/registry'

const mocks = vi.hoisted(() => ({
  exportVideo: vi.fn(),
  saveVideo: vi.fn()
}))

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('../src/renderer/src/recording/export', () => ({ exportRecordingVideo: mocks.exportVideo }))
vi.mock('../src/renderer/src/platform/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/src/platform/bridge')>()),
  bridge: { revealFile: vi.fn() },
  saveVideo: mocks.saveVideo
}))

const { exportRecording } = await import('../src/renderer/src/recording/actions')
const { setSize } = await import('../src/renderer/src/app/actions')
const { registerRecording } = await import('../src/renderer/src/recording/registry')
const { DEFAULT_RECORDING } = await import('../src/renderer/src/recording/settings')
const { emptyDoc, isUnsaved, store, updateDoc, liveShots } = await import('../src/renderer/src/app/store')

const entry: RecordingEntry = {
  id: 'rec1',
  name: 'Recording',
  track: { kind: 'monitor', width: 1920, height: 1080, fps: 60, durationMs: 2000, scale: 1, cursor: [], clicks: [] },
  poster: null
}

const activeShot = () => liveShots().find((record) => record.id === store.get().activeId)!

beforeEach(() => {
  vi.clearAllMocks()
  registerRecording(entry)
  updateDoc({ ...emptyDoc(), sourceId: entry.id, size: { width: 1920, height: 1080 }, recording: { ...DEFAULT_RECORDING, trim: { start: 0, end: 1000 } }, fileName: '' })
  store.set({ exportProgress: null })
  mocks.exportVideo.mockResolvedValue(new Uint8Array([1, 2, 3]))
  mocks.saveVideo.mockResolvedValue({ path: ['C:', 'Videos', 'clip.mp4'].join(String.fromCharCode(92)) })
})

describe('exportRecording', () => {
  it('reports progress and clears it when the save finishes', async () => {
    const seen: (number | null)[] = []
    store.subscribe(() => seen.push(store.get().exportProgress))
    mocks.exportVideo.mockImplementation(async (_entry, _doc, _style, _backdrop, onProgress) => {
      onProgress(0.5)
      return new Uint8Array([1])
    })
    await exportRecording()
    expect(seen).toContain(0.5)
    expect(store.get().exportProgress).toBeNull()
    expect(toast.success).toHaveBeenCalledWith('Saved clip.mp4', expect.anything())
  })

  it('ignores a second export while one runs', async () => {
    let finish: (bytes: Uint8Array) => void = () => undefined
    mocks.exportVideo.mockReturnValue(new Promise<Uint8Array>((resolve) => (finish = resolve)))
    const first = exportRecording()
    await vi.waitFor(() => expect(mocks.exportVideo).toHaveBeenCalledTimes(1))
    await exportRecording()
    expect(mocks.exportVideo).toHaveBeenCalledTimes(1)
    finish(new Uint8Array([1]))
    await first
  })

  it('clears progress when the save dialog is cancelled', async () => {
    mocks.saveVideo.mockResolvedValue(null)
    await exportRecording()
    expect(store.get().exportProgress).toBeNull()
    expect(toast.success).not.toHaveBeenCalled()
    expect(isUnsaved(activeShot())).toBe(true)
  })

  it('clears progress and shows the error when the export fails', async () => {
    mocks.exportVideo.mockRejectedValue(new Error('No encoder'))
    await exportRecording()
    expect(store.get().exportProgress).toBeNull()
    expect(toast.error).toHaveBeenCalledWith('Export failed', { description: 'No encoder' })
  })

  it('marks the exported snapshot as saved, not edits made during the export', async () => {
    const exported = store.get().doc
    mocks.exportVideo.mockImplementation(async () => {
      updateDoc({ fileName: 'edited meanwhile' })
      return new Uint8Array([1])
    })
    await exportRecording()
    expect(activeShot().savedDoc).toBe(exported)
    expect(isUnsaved(activeShot())).toBe(true)
  })

  it('hands the saved file the name of the shot', async () => {
    updateDoc({ fileName: 'Billing costs' })
    await exportRecording()
    expect(mocks.saveVideo).toHaveBeenCalledWith(expect.any(Uint8Array), 'billing-costs.mp4')
  })
})

describe('recording size', () => {
  it('keeps a recording shot at even sizes', () => {
    setSize({ width: 1921, height: 1081 })
    expect(store.get().doc.size).toEqual({ width: 1922, height: 1082 })
  })

  it('leaves a screenshot shot as typed', () => {
    updateDoc({ recording: null })
    setSize({ width: 1921, height: 1081 })
    expect(store.get().doc.size).toEqual({ width: 1921, height: 1081 })
  })
})
