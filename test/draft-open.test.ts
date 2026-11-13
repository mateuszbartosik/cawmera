import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { toast } from 'sonner'
import { DRAFT_BUSY, type CawmeraBridge, type DraftFiles, type DraftOpenResult } from '@shared/types'
import type { Doc } from '../src/renderer/src/app/doc'
import type { HouseStyle } from '../src/renderer/src/app/house-style'
import type { ShotRecord, SourceEntry } from '../src/renderer/src/app/store'
import type { DraftContents } from '../src/renderer/src/drafts/model'
import type { RecordingEntry } from '../src/renderer/src/recording/registry'
import type { RecordingTrack } from '../src/renderer/src/recording/track'

const mocks = vi.hoisted(() => {
  const listeners = new Set<(share: number) => void>()
  return {
    listeners,
    bridge: {
      getVersion: vi.fn(async () => '0.8.0'),
      openDraft: vi.fn<CawmeraBridge['openDraft']>(),
      saveDraft: vi.fn<CawmeraBridge['saveDraft']>(),
      onDraftProgress: vi.fn((listener: (share: number) => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }),
      confirmDiscard: vi.fn<CawmeraBridge['confirmDiscard']>(),
      pathForFile: vi.fn((file: File) => `C:\\Drafts\\${file.name}`),
      revealFile: vi.fn(async (_path: string) => undefined)
    }
  }
})

vi.mock('sonner', () => ({
  toast: Object.assign(
    vi.fn(() => 'shot-deleted'),
    { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => 'opening'), dismiss: vi.fn() }
  )
}))
vi.mock('../src/renderer/src/platform/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/src/platform/bridge')>()),
  bridge: mocks.bridge,
  isDesktop: true
}))

interface FakeBitmap {
  width: number
  height: number
  close: Mock<() => void>
}

/** Fake PNGs carry their size where a real one does; these body bytes make one that won't decode, or decodes wider than its header says. */
const UNDECODABLE = 0xff
const MISREPORTED = 0xfe
const decoded: FakeBitmap[] = []
const poster = { width: 1280, height: 720, close: vi.fn() }

vi.stubGlobal(
  'createImageBitmap',
  vi.fn(async (source: unknown) => {
    if (!(source instanceof Blob)) return poster
    const bytes = new Uint8Array(await source.arrayBuffer())
    if (bytes[24] === UNDECODABLE) throw new Error('The source image could not be decoded')
    const header = new DataView(bytes.buffer)
    const bitmap = { width: header.getUint32(16) + (bytes[24] === MISREPORTED ? 1 : 0), height: header.getUint32(20), close: vi.fn() }
    decoded.push(bitmap)
    return bitmap
  })
)

type FakeElement = Record<string, unknown> & { tag: string }
const elements: FakeElement[] = []
const createdOf = (tag: string) => elements.filter((element) => element.tag === tag)
vi.stubGlobal('document', {
  createElement: (tag: string) => {
    const element: FakeElement = { tag, removeAttribute: vi.fn(), load: vi.fn(), click: vi.fn() }
    elements.push(element)
    return element
  }
})

vi.stubGlobal(
  'OffscreenCanvas',
  class {
    getContext() {
      return { drawImage: () => undefined }
    }
    async convertToBlob() {
      return new Blob(['png'])
    }
  }
)

const { applyOpenedDraft, draftAmong, openDraft, openDraftAmong, openDraftFile, saveDraft, saveDraftUnlessBusy, saveOrDiscardUnsaved } = await import(
  '../src/renderer/src/drafts/actions'
)
const { deleteShots, openFilePicker } = await import('../src/renderer/src/app/actions')
const { DEFAULT_DOC } = await import('../src/renderer/src/app/doc')
const { DEFAULT_HOUSE_STYLE, serializeHouseStyle } = await import('../src/renderer/src/app/house-style')
const { FIT_ALL, getSource, liveShots, registerSource, store, unsavedCount, updateDoc } = await import('../src/renderer/src/app/store')
const { getRecording, registerRecording } = await import('../src/renderer/src/recording/registry')
const { DEFAULT_RECORDING } = await import('../src/renderer/src/recording/settings')
const { serializeTrack } = await import('../src/renderer/src/recording/track')

const track: RecordingTrack = {
  kind: 'window',
  width: 1280,
  height: 720,
  fps: 60,
  durationMs: 4000,
  scale: 1,
  cursor: [
    { t: 0, x: 10, y: 20, shape: 'arrow' },
    { t: 2000, x: 300, y: 200, shape: 'hand' }
  ],
  clicks: [{ t: 1000, x: 10, y: 20, button: 'left', up: 1100 }]
}
const style: HouseStyle = { ...DEFAULT_HOUSE_STYLE, name: 'Mine', plateFrom: '#112233' }
const emptyDoc: Doc = { ...DEFAULT_DOC, angle: 100 }
const screenshotDoc: Doc = {
  ...DEFAULT_DOC,
  sourceId: 'image1',
  capturedAt: 2,
  angle: 200,
  crop: { x: 0, y: 0, w: 400, h: 300 },
  redactions: [{ id: 'r1', rect: { x: 5, y: 5, w: 50, h: 50 }, time: null }],
  fileName: 'billing'
}
const recordingDoc: Doc = {
  ...DEFAULT_DOC,
  sourceId: 'take1',
  size: { width: 1920, height: 1080 },
  crop: { x: 0, y: 0, w: 640, h: 360 },
  redactions: [{ id: 'r2', rect: { x: 10, y: 10, w: 100, h: 40 }, time: { start: 2000, end: 3000 } }],
  recording: {
    ...DEFAULT_RECORDING,
    cursorSize: 2,
    trim: { start: 500, end: 3500 },
    pieces: [
      { start: 0, end: 1000, rate: 1, cut: false },
      { start: 1000, end: 2000, rate: 1, cut: true },
      { start: 2000, end: 4000, rate: 2, cut: false }
    ],
    zooms: null
  }
}
const OPENED_TAKE = '3f2a3b19-e3de-4153-9d82-95ac5c46cbd1'

function manifest(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: 'cawmera-draft',
    version: 1,
    savedBy: '0.8.0',
    style: serializeHouseStyle(style),
    active: 2,
    shots: [
      { kind: 'empty', doc: emptyDoc },
      { kind: 'screenshot', key: 'image1', source: { name: 'billing.png', origin: 'paste', detected: 2 }, doc: screenshotDoc },
      { kind: 'recording', key: 'take1', name: 'Billing', doc: recordingDoc }
    ],
    ...fields
  })
}

const screenshotShot = (key: string) => ({ kind: 'screenshot', key, source: { name: `${key}.png`, origin: 'file', detected: 1 }, doc: { ...DEFAULT_DOC, sourceId: key } })

const TAKE_IDS = ['5a0e7c1d-2b4f-4e83-9c61-0d8f3a7b2e15', '6b1f8d2e-3c50-4f94-8d72-1e9a4b8c3f26', '7c2a9e3f-4d61-4a05-9e83-2fab5c9d4a37']

/** A draft of recording shots, one for each of the first `shownCount` takes; the rest come in the file with no shot showing them. */
const recordingsDraft = (recordings: DraftFiles['recordings'], shownCount = recordings.length): DraftOpenResult => ({
  ok: true,
  files: {
    manifest: manifest({ active: 0, shots: recordings.slice(0, shownCount).map(({ key }) => ({ kind: 'recording', key, name: 'Billing', doc: recordingDoc })) }),
    screenshots: [],
    recordings
  }
})

/** A draft of screenshots only, one shot each. */
const screenshotsDraft = (screenshots: DraftFiles['screenshots']): DraftOpenResult => ({
  ok: true,
  files: { manifest: manifest({ active: 0, shots: screenshots.map(({ key }) => screenshotShot(key)) }), screenshots, recordings: [] }
})

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]
const JPEG_START = [0xff, 0xd8, 0xff, 0xfe, 0x00, 0x16, 0x00, 0x00]
const IDAT = [0x49, 0x44, 0x41, 0x54]

function png(width: number, height: number, body = 0): Uint8Array {
  const bytes = new Uint8Array(25)
  bytes.set(PNG_HEADER)
  const header = new DataView(bytes.buffer)
  header.setUint32(16, width)
  header.setUint32(20, height)
  bytes[24] = body
  return bytes
}

function overwritten(bytes: Uint8Array, offset: number, values: number[]): Uint8Array {
  const copy = bytes.slice()
  copy.set(values, offset)
  return copy
}

const opened = (changes: Partial<DraftFiles> = {}): DraftOpenResult => ({
  ok: true,
  files: {
    manifest: manifest(),
    screenshots: [{ key: 'image1', bytes: png(800, 600) }],
    recordings: [{ key: 'take1', id: OPENED_TAKE, track: serializeTrack(track) }],
    ...changes
  }
})

function openedParts(): { contents: DraftContents; sources: Map<string, SourceEntry>; recordings: Map<string, RecordingEntry> } {
  const contents: DraftContents = {
    style,
    active: 2,
    shots: [
      { kind: 'empty', doc: emptyDoc },
      { kind: 'screenshot', key: 'image1', doc: screenshotDoc, source: { name: 'billing.png', origin: 'paste', detected: 2 } },
      { kind: 'recording', key: 'take1', doc: recordingDoc, name: 'Billing' }
    ]
  }
  const bitmap = { width: 800, height: 600, close: vi.fn() } as unknown as ImageBitmap
  const source: SourceEntry = { id: 'source-1', bitmap, width: 800, height: 600, name: 'billing.png', origin: 'paste', detected: 2 }
  const recording: RecordingEntry = { id: 'take-1', name: 'Billing', track, poster: null }
  return { contents, sources: new Map([['image1', source]]), recordings: new Map([['take1', recording]]) }
}

const report = (share: number) => mocks.listeners.forEach((listener) => listener(share))
const nothingDecodedKept = () => decoded.filter((bitmap) => bitmap.close.mock.calls.length === 0)

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => (resolve = settle))
  return { promise, resolve }
}

let previousBitmap: FakeBitmap

/** The canvas before opening: a screenshot that isn't saved anywhere, with a step of history, and an empty shot. */
function setPreviousCanvas() {
  previousBitmap = { width: 400, height: 300, close: vi.fn() }
  registerSource({ id: 'previous', bitmap: previousBitmap as unknown as ImageBitmap, width: 400, height: 300, name: 'old.png', origin: 'file', detected: 1 })
  const shots: ShotRecord[] = [{ ...DEFAULT_DOC, sourceId: 'previous' }, { ...DEFAULT_DOC }].map((doc, index) => ({
    id: `shot-${index}`,
    doc,
    past: [],
    future: [],
    savedDoc: null,
    draftDoc: null
  }))
  store.set({ shots, activeId: 'shot-0', doc: shots[0].doc, past: [], future: [], savedDoc: null, draftDoc: null, timelineSelection: null })
  updateDoc({ angle: 10 })
  store.set({ mode: 'crop', shotSelection: ['shot-0', 'shot-1'], view: { fit: null, zoom: 2, cx: 50, cy: 50 } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listeners.clear()
  decoded.length = 0
  elements.length = 0
  mocks.bridge.confirmDiscard.mockResolvedValue('discard')
  mocks.bridge.openDraft.mockResolvedValue(opened())
  mocks.bridge.saveDraft.mockResolvedValue({ path: 'C:\\Drafts\\before.cawmera' })
  setPreviousCanvas()
})

describe('applyOpenedDraft', () => {
  it('replaces the canvas with an opened draft and forgets the history', () => {
    const { contents, sources, recordings } = openedParts()
    applyOpenedDraft(contents, sources, recordings)
    const s = store.get()
    expect(s.shots.map((r) => r.doc.sourceId)).toEqual([null, 'source-1', 'take-1'])
    expect(s.activeId).toBe(s.shots[2].id)
    expect(s.style).toEqual(contents.style)
    expect([s.past, s.future]).toEqual([[], []])
  })

  it('counts every opened shot as saved in the draft, registers its screenshots and takes, and lets go of the old screenshots', () => {
    const { contents, sources, recordings } = openedParts()
    applyOpenedDraft(contents, sources, recordings)
    expect(liveShots().map(({ doc, past, future, savedDoc, draftDoc }) => [past, future, savedDoc, draftDoc === doc])).toEqual([
      [[], [], null, true],
      [[], [], null, true],
      [[], [], null, true]
    ])
    expect(unsavedCount()).toBe(0)
    expect(getSource('source-1')).toBe(sources.get('image1'))
    expect(getRecording('take-1')).toBe(recordings.get('take1'))
    expect(getSource('previous')).toBeNull()
    expect(previousBitmap.close).toHaveBeenCalled()
    expect(store.get()).toMatchObject({ mode: 'compose', selection: [], shotSelection: [], timelineSelection: null, view: FIT_ALL })
  })

  it('lets go of the takes no opened shot shows, posters included, and keeps the opened ones', () => {
    const oldPoster = { width: 1280, height: 720, close: vi.fn() }
    registerRecording({ id: 'old-take', name: 'Old', track, poster: oldPoster as unknown as ImageBitmap })
    registerRecording({ id: 'deleted-take', name: 'Deleted', track, poster: null })
    updateDoc({ sourceId: 'old-take', recording: recordingDoc.recording })
    const { contents, sources, recordings } = openedParts()
    applyOpenedDraft(contents, sources, recordings)
    expect(getRecording('old-take')).toBeNull()
    expect(getRecording('deleted-take')).toBeNull()
    expect(oldPoster.close).toHaveBeenCalledTimes(1)
    expect(getRecording('take-1')).toBe(recordings.get('take1'))
  })

  it('reads each take’s poster as a finished take does', async () => {
    const { contents, sources, recordings } = openedParts()
    applyOpenedDraft(contents, sources, recordings)
    const [video] = createdOf('video')
    expect(video.src).toBe('cawmera-media://recording/take-1')
    ;(video.onloadeddata as () => void)()
    await vi.waitFor(() => expect(getRecording('take-1')?.poster).toBe(poster))
  })

  it('turns a pending “Shot deleted” Undo into a no-op once a draft replaces the canvas, and dismisses its toast', async () => {
    deleteShots(['shot-0'])
    const [, options] = vi.mocked(toast).mock.calls.find(([title]) => title === 'Shot deleted')!
    const undo = options?.action as unknown as { onClick: () => void }
    await openDraft(null)
    const openedShots = store.get().shots
    undo.onClick()
    expect(store.get().shots).toBe(openedShots)
    expect(toast.dismiss).toHaveBeenCalledWith('shot-deleted')
  })
})

describe('openDraft', () => {
  it('leaves the canvas alone when a draft can’t be opened', async () => {
    const before = store.get().shots
    mocks.bridge.openDraft.mockResolvedValue({ ok: false, reason: 'damaged', message: 'Unexpected end' })
    await openDraft('C:\\broken.cawmera')
    expect(store.get().shots).toBe(before)
    expect(toast.error).toHaveBeenCalledWith('The draft is damaged', expect.anything())
  })

  it('brings back every shot, edit and the house style, showing progress, then names the style', async () => {
    mocks.bridge.openDraft.mockImplementation(async () => {
      report(0.42)
      report(1)
      return opened()
    })
    expect(await openDraft(null)).toBe(true)
    expect(mocks.bridge.confirmDiscard).toHaveBeenCalledWith(1, 'open')
    expect(mocks.bridge.openDraft).toHaveBeenCalledWith(null)
    const [empty, screenshot, take] = liveShots()
    expect(empty.doc).toEqual(emptyDoc)
    expect(screenshot.doc).toEqual({ ...screenshotDoc, sourceId: screenshot.doc.sourceId })
    expect(take.doc).toEqual({ ...recordingDoc, sourceId: OPENED_TAKE })
    expect(store.get().activeId).toBe(take.id)
    expect(store.get().style).toEqual(style)
    expect(getSource(screenshot.doc.sourceId)).toMatchObject({ width: 800, height: 600, name: 'billing.png', origin: 'paste', detected: 2 })
    expect(getRecording(OPENED_TAKE)).toMatchObject({ id: OPENED_TAKE, name: 'Billing', track })
    expect(unsavedCount()).toBe(0)
    expect(vi.mocked(toast.loading).mock.calls).toEqual([
      ['Opening draft… 42%', { id: undefined }],
      ['Opening draft… 100%', { id: 'opening' }]
    ])
    expect(toast.success).toHaveBeenCalledWith('Mine house style imported', { id: 'opening' })
  })

  it.each([
    ['isn’t a draft', 'not-a-draft', 'That file isn’t a Cawmera draft'],
    ['is damaged', 'damaged', 'The draft is damaged'],
    ['is too large', 'too-large', 'The draft couldn’t be opened'],
    ['can’t be read', 'unreadable', 'The draft couldn’t be opened']
  ] as const)('names the reason when the file %s, with main’s details, and leaves the canvas as it was without asking', async (_, reason, title) => {
    const before = store.get()
    mocks.bridge.openDraft.mockResolvedValue({ ok: false, reason, message: 'Not a .cawmera file on a local drive' })
    expect(await openDraft(null)).toBe(false)
    expect(store.get().shots).toBe(before.shots)
    expect(store.get().style).toBe(before.style)
    expect(toast.error).toHaveBeenCalledWith(title, { id: undefined, description: 'Not a .cawmera file on a local drive' })
    expect(toast.success).not.toHaveBeenCalled()
    expect(mocks.bridge.confirmDiscard).not.toHaveBeenCalled()
  })

  it.each([
    ['comes from a newer Cawmera', { manifest: manifest({ version: 2 }) }, 'This draft was made by a newer Cawmera'],
    ['holds something else', { manifest: JSON.stringify({ format: 'cawmera-template', version: 1 }) }, 'That file isn’t a Cawmera draft'],
    ['misses a shot’s screenshot', { screenshots: [] }, 'The draft is damaged'],
    ['holds a screenshot that won’t decode', { screenshots: [{ key: 'image1', bytes: png(800, 600, UNDECODABLE) }] }, 'The draft is damaged'],
    ['holds a screenshot that decodes to another size than its header’s', { screenshots: [{ key: 'image1', bytes: png(800, 600, MISREPORTED) }] }, 'The draft is damaged'],
    ['holds a broken track', { recordings: [{ key: 'take1', id: OPENED_TAKE, track: '{"version":1}' }] }, 'The draft is damaged'],
    ['holds a track hours longer than any take', { recordings: [{ key: 'take1', id: OPENED_TAKE, track: serializeTrack({ ...track, durationMs: 1e11 }) }] }, 'The draft is damaged']
  ])('leaves the canvas as it was, keeping no screenshot and asking nothing, when the draft %s', async (_, changes, title) => {
    const before = store.get()
    mocks.bridge.openDraft.mockResolvedValue(opened(changes))
    expect(await openDraft(null)).toBe(false)
    expect(store.get().shots).toBe(before.shots)
    expect(store.get().style).toBe(before.style)
    expect(toast.error).toHaveBeenCalledWith(title, expect.anything())
    expect(nothingDecodedKept()).toEqual([])
    expect(mocks.bridge.confirmDiscard).not.toHaveBeenCalled()
  })

  it('lets go of every screenshot decoded before one that won’t decode', async () => {
    const draft = screenshotsDraft([
      { key: 'image1', bytes: png(40, 30) },
      { key: 'image2', bytes: png(800, 600, UNDECODABLE) }
    ])
    mocks.bridge.openDraft.mockResolvedValue(draft)
    await openDraft(null)
    expect(decoded).toHaveLength(1)
    expect(nothingDecodedKept()).toEqual([])
    expect(toast.error).toHaveBeenCalledWith('The draft is damaged', expect.anything())
  })

  it.each([
    ['a JPEG that carries “IHDR” and 1 × 1 where a PNG header would be', overwritten(png(1, 1), 0, JPEG_START)],
    ['a header cut short', png(800, 600).slice(0, 23)],
    ['no IHDR chunk first', overwritten(png(800, 600), 12, IDAT)],
    ['an IHDR chunk of the wrong length', overwritten(png(800, 600), 8, [0, 0, 0, 12])],
    ['a header claiming over 60 megapixels', png(10_000, 6001)]
  ])('decodes no screenshot with %s, and calls the draft damaged', async (_, bytes) => {
    mocks.bridge.openDraft.mockResolvedValue(opened({ screenshots: [{ key: 'image1', bytes }] }))
    expect(await openDraft(null)).toBe(false)
    expect(createImageBitmap).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('The draft is damaged', expect.anything())
  })

  it('opens screenshots of up to 400 megapixels together, and decodes none of a draft whose screenshots claim more', async () => {
    const keys = ['image1', 'image2', 'image3', 'image4', 'image5', 'image6']
    const sixtyEach = keys.map((key) => ({ key, bytes: png(10_000, 6000) }))
    mocks.bridge.openDraft.mockResolvedValue(screenshotsDraft([...sixtyEach, { key: 'image7', bytes: png(1, 40_000_001) }]))
    expect(await openDraft(null)).toBe(false)
    expect(createImageBitmap).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('The draft couldn’t be opened', { id: undefined, description: 'Its screenshots add up to more than 400 megapixels.' })

    mocks.bridge.openDraft.mockResolvedValue(screenshotsDraft([...sixtyEach, { key: 'image7', bytes: png(1, 40_000_000) }]))
    expect(await openDraft(null)).toBe(true)
    expect(decoded).toHaveLength(7)
    expect(liveShots().map((record) => getSource(record.doc.sourceId)?.height)).toEqual([6000, 6000, 6000, 6000, 6000, 6000, 40_000_000])
  })

  it('neither decodes nor counts a screenshot in the file that no shot shows', async () => {
    const unused = ['image2', 'image3', 'image4', 'image5', 'image6', 'image7', 'image8'].map((key) => ({ key, bytes: png(10_000, 6000) }))
    mocks.bridge.openDraft.mockResolvedValue(
      opened({ screenshots: [{ key: 'image1', bytes: png(800, 600) }, ...unused, { key: 'image9', bytes: overwritten(png(1, 1), 0, JPEG_START) }] })
    )
    expect(await openDraft(null)).toBe(true)
    expect(decoded).toHaveLength(1)
    expect(getSource(liveShots()[1].doc.sourceId)?.bitmap).toBe(decoded[0])
  })

  it('reads no track that no shot shows, so a broken one there doesn’t stop the draft', async () => {
    const unused = [
      { key: 'take2', id: 'b5d3c6a1-3f0e-4c38-9a51-6f2b8e0d7c14', track: '{"version":1}' },
      { key: 'take3', id: 'c0a4e2f9-8b17-4d6e-a3c5-1e9f7b2d4a60', track: '{' }
    ]
    mocks.bridge.openDraft.mockResolvedValue(opened({ recordings: [{ key: 'take1', id: OPENED_TAKE, track: serializeTrack(track) }, ...unused] }))
    expect(await openDraft(null)).toBe(true)
    expect(getRecording(OPENED_TAKE)).toMatchObject({ track })
    for (const { id } of unused) expect(getRecording(id)).toBeNull()
  })

  it('refuses a draft whose shown tracks add up to more than 64 MB, reading none of them and asking nothing', async () => {
    const before = store.get()
    const notTracks = [32_000_000, 31_999_999, 2].map((bytes, i) => ({ key: `take${i + 1}`, id: TAKE_IDS[i], track: ' '.repeat(bytes) }))
    mocks.bridge.openDraft.mockResolvedValue(recordingsDraft(notTracks))
    expect(await openDraft(null)).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('The draft couldn’t be opened', { id: undefined, description: 'Its recordings add up to more than a draft can hold.' })
    expect(store.get().shots).toBe(before.shots)
    expect(mocks.bridge.confirmDiscard).not.toHaveBeenCalled()
  })

  it('opens a draft whose shown tracks come to exactly 64 MB, not counting a track no shot shows', async () => {
    const atTheTrackLimit = serializeTrack(track).padEnd(32_000_000, ' ')
    const shown = [0, 1].map((i) => ({ key: `take${i + 1}`, id: TAKE_IDS[i], track: atTheTrackLimit }))
    const unshown = { key: 'take3', id: TAKE_IDS[2], track: ' '.repeat(32_000_000) }
    mocks.bridge.openDraft.mockResolvedValue(recordingsDraft([...shown, unshown], 2))
    expect(await openDraft(null)).toBe(true)
    expect(liveShots().map((record) => record.doc.sourceId)).toEqual([TAKE_IDS[0], TAKE_IDS[1]])
    expect(getRecording(TAKE_IDS[0])).toMatchObject({ track })
    expect(getRecording(TAKE_IDS[2])).toBeNull()
  })

  it('asks about unsaved work only once the draft is read and decoded, just before replacing the canvas', async () => {
    expect(await openDraft(null)).toBe(true)
    const [asked] = mocks.bridge.confirmDiscard.mock.invocationCallOrder
    expect(asked).toBeGreaterThan(mocks.bridge.openDraft.mock.invocationCallOrder[0])
    expect(asked).toBeGreaterThan(vi.mocked(createImageBitmap).mock.invocationCallOrder[0])
  })

  it('counts edits made while the draft was read as unsaved work to ask about', async () => {
    store.set({ draftDoc: store.get().doc })
    mocks.bridge.openDraft.mockImplementation(async () => {
      updateDoc({ angle: 77 })
      return opened()
    })
    await openDraft(null)
    expect(mocks.bridge.confirmDiscard).toHaveBeenCalledWith(1, 'open')
  })

  it('on Cancel keeps the canvas, lets go of everything decoded, and takes the progress away', async () => {
    const before = store.get()
    mocks.bridge.openDraft.mockImplementation(async () => {
      report(1)
      return opened()
    })
    mocks.bridge.confirmDiscard.mockResolvedValue('keep')
    expect(await openDraft(null)).toBe(false)
    expect(store.get().shots).toBe(before.shots)
    expect(store.get().style).toBe(before.style)
    expect(decoded).toHaveLength(1)
    expect(nothingDecodedKept()).toEqual([])
    expect(toast.dismiss).toHaveBeenCalledWith('opening')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('on Save draft… saves the canvas as it is then, edits made while reading included, and opens once it’s saved', async () => {
    mocks.bridge.openDraft.mockImplementation(async () => {
      updateDoc({ angle: 77 })
      return opened()
    })
    mocks.bridge.confirmDiscard.mockResolvedValue('save')
    mocks.bridge.saveDraft.mockResolvedValue(null)
    expect(await openDraft(null)).toBe(false)
    expect(nothingDecodedKept()).toEqual([])
    expect(store.get().doc.angle).toBe(77)

    mocks.bridge.saveDraft.mockResolvedValue({ path: 'C:\\Drafts\\before.cawmera' })
    expect(await openDraft(null)).toBe(true)
    const [files] = mocks.bridge.saveDraft.mock.calls[1]
    expect(JSON.parse(files.manifest).shots[0].doc.angle).toBe(77)
    expect(mocks.bridge.saveDraft.mock.invocationCallOrder[1]).toBeGreaterThan(mocks.bridge.openDraft.mock.invocationCallOrder[1])
    expect(store.get().style).toEqual(style)
  })

  it('changes nothing when the open dialog is cancelled', async () => {
    const before = store.get()
    mocks.bridge.openDraft.mockResolvedValue(null)
    expect(await openDraft(null)).toBe(false)
    expect(store.get().shots).toBe(before.shots)
    expect([toast.loading, toast.success, toast.error].map((show) => vi.mocked(show).mock.calls.length)).toEqual([0, 0, 0])
  })

  it('opens one draft at a time, and keeps Save draft disabled until it’s open', async () => {
    const reading = deferred<DraftOpenResult | null>()
    mocks.bridge.openDraft.mockImplementation(() => reading.promise)
    const first = openDraft(null)
    expect(store.get().draftBusy).toBe(true)
    await vi.waitFor(() => expect(mocks.bridge.openDraft).toHaveBeenCalledTimes(1))
    expect(await openDraft('C:\\Drafts\\second.cawmera')).toBe(false)
    expect(mocks.bridge.openDraft).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('The draft couldn’t be opened', { description: DRAFT_BUSY })
    reading.resolve(null)
    await first
    expect(store.get().draftBusy).toBe(false)
  })

  it('opens no draft while one is being saved', async () => {
    const writing = deferred<{ path: string } | null>()
    mocks.bridge.saveDraft.mockImplementation(() => writing.promise)
    const saving = saveDraft()
    expect(await openDraft(null)).toBe(false)
    expect(mocks.bridge.openDraft).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('The draft couldn’t be opened', { description: DRAFT_BUSY })
    writing.resolve(null)
    await saving
    expect(store.get().draftBusy).toBe(false)
  })

  it('stays busy through its own Save draft…, until the draft is open', async () => {
    mocks.bridge.confirmDiscard.mockResolvedValue('save')
    const writing = deferred<{ path: string } | null>()
    mocks.bridge.saveDraft.mockImplementation(() => writing.promise)
    const opening = openDraft(null)
    await vi.waitFor(() => expect(mocks.bridge.saveDraft).toHaveBeenCalledTimes(1))
    expect(store.get().draftBusy).toBe(true)
    writing.resolve({ path: 'C:\\Drafts\\before.cawmera' })
    expect(await opening).toBe(true)
    expect(store.get().draftBusy).toBe(false)
  })

  it('refuses the close dialog’s Save draft… while a draft opens', async () => {
    const reading = deferred<DraftOpenResult | null>()
    mocks.bridge.openDraft.mockImplementation(() => reading.promise)
    const opening = openDraft(null)
    mocks.bridge.confirmDiscard.mockResolvedValue('save')
    expect(await saveOrDiscardUnsaved('close')).toBe(false)
    expect(mocks.bridge.saveDraft).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('The draft couldn’t be saved', { description: DRAFT_BUSY })
    reading.resolve(null)
    await opening
  })

  it('leaves Save draft from the menu or Ctrl+Shift+D alone while a draft opens, as the disabled button does', async () => {
    const reading = deferred<DraftOpenResult | null>()
    mocks.bridge.openDraft.mockImplementation(() => reading.promise)
    const opening = openDraft(null)
    saveDraftUnlessBusy()
    expect(mocks.bridge.getVersion).not.toHaveBeenCalled()
    reading.resolve(null)
    await opening
    saveDraftUnlessBusy()
    await vi.waitFor(() => expect(mocks.bridge.saveDraft).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(store.get().draftBusy).toBe(false))
  })
})

describe('dropped and picked drafts', () => {
  it('opens a dropped draft from its path on disk', async () => {
    const file = new File(['draft'], 'Launch.cawmera')
    expect(await openDraftFile(file)).toBe(true)
    expect(mocks.bridge.pathForFile).toHaveBeenCalledWith(file)
    expect(mocks.bridge.openDraft).toHaveBeenCalledWith('C:\\Drafts\\Launch.cawmera')
  })

  it('takes the first draft among the files, and none from other files', () => {
    const image = new File([''], 'shot.png', { type: 'image/png' })
    const draft = new File([''], 'Launch.CAWMERA')
    expect(draftAmong([image, draft, new File([''], 'Other.cawmera')])).toBe(draft)
    expect(draftAmong([image, new File([''], 'notes.txt')])).toBeUndefined()
    expect(openDraftAmong([image])).toBeNull()
  })

  it('opens a draft that came with other files alone, and says so once it’s open', async () => {
    const image = new File([''], 'shot.png', { type: 'image/png' })
    const draft = new File([''], 'Launch.cawmera')
    expect(await openDraftAmong([image, draft])).toBe(true)
    expect(toast.info).toHaveBeenCalledWith('Only the draft was opened, not the other files')

    vi.mocked(toast.info).mockClear()
    expect(await openDraftAmong([draft])).toBe(true)
    mocks.bridge.openDraft.mockResolvedValue({ ok: false, reason: 'damaged', message: 'Unexpected end' })
    expect(await openDraftAmong([image, draft])).toBe(false)
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('lets the file picker take drafts too, and opens a picked one alone', async () => {
    openFilePicker()
    const [input] = createdOf('input')
    expect(input.accept).toBe('image/png,image/jpeg,image/webp,image/gif,image/bmp,.cawmera')
    input.files = [new File([''], 'shot.png', { type: 'image/png' }), new File([''], 'Launch.cawmera')]
    ;(input.onchange as () => void)()
    await vi.waitFor(() => expect(mocks.bridge.openDraft).toHaveBeenCalledWith('C:\\Drafts\\Launch.cawmera'))
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalledWith('Only the draft was opened, not the other files'))
    expect(getSource('previous')).toBeNull()
  })
})
