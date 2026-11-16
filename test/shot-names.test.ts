import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { RecordingEntry } from '../src/renderer/src/recording/registry'

const mocks = vi.hoisted(() => ({
  /** The random source the store draws shot names from. */
  naming: { random: Math.random as () => number },
  saveImage: vi.fn(async () => ({ path: null })),
  saveImages: vi.fn(async (images: { name: string }[]) => ({ folder: 'C:\\Shots', count: images.length })),
  saveVideo: vi.fn(async () => ({ path: null })),
  exportVideo: vi.fn(async () => new Uint8Array([1]))
}))

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('../src/renderer/src/app/shot-names', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/renderer/src/app/shot-names')>()
  return { ...original, uniqueShotName: (taken: ReadonlySet<string>, random = mocks.naming.random) => original.uniqueShotName(taken, random) }
})
vi.mock('../src/renderer/src/render/compose', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/src/render/compose')>()),
  renderImage: vi.fn(async () => new Blob(['image']))
}))
vi.mock('../src/renderer/src/recording/export', () => ({ exportRecordingVideo: mocks.exportVideo }))
vi.mock('../src/renderer/src/platform/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/src/platform/bridge')>()),
  saveImage: mocks.saveImage,
  saveImages: mocks.saveImages,
  saveVideo: mocks.saveVideo
}))

const { isShotName, randomShotName, settledShotNames, SHOT_NAME_WORDS, uniqueShotName } = await import('../src/renderer/src/app/shot-names')
const { exportAll, exportImage, resetAll, setFileName, shotFileName } = await import('../src/renderer/src/app/actions')
const { DEFAULT_DOC, slugify } = await import('../src/renderer/src/app/doc')
const { DEFAULT_HOUSE_STYLE } = await import('../src/renderer/src/app/house-style')
const { activeShotName, addShot, liveShots, redo, registerSource, removeShots, restoreShots, store, undo, unsavedCount, updateDoc } = await import(
  '../src/renderer/src/app/store'
)
const { applyOpenedDraft } = await import('../src/renderer/src/drafts/actions')
const { exportRecording } = await import('../src/renderer/src/recording/actions')
const { registerRecording } = await import('../src/renderer/src/recording/registry')
const { DEFAULT_RECORDING } = await import('../src/renderer/src/recording/settings')
const { wholeTake } = await import('../src/renderer/src/recording/timemap')

/** Hands out `values` in turn, then real random numbers. */
const scripted = (...values: number[]) => {
  let next = 0
  return () => (next < values.length ? values[next++] : Math.random())
}

const take: RecordingEntry = {
  id: 'take-names',
  name: 'Notes',
  track: { kind: 'window', width: 1280, height: 720, fps: 60, durationMs: 2000, scale: 1, cursor: [], clicks: [] },
  poster: null
}
const recordingDoc = { ...DEFAULT_DOC, sourceId: take.id, recording: { ...DEFAULT_RECORDING, trim: { start: 0, end: 2000 }, pieces: wholeTake(2000), zooms: null } }

registerSource({ id: 'image-names', bitmap: { close: vi.fn() } as unknown as ImageBitmap, width: 800, height: 500, name: 'shot.png', origin: 'paste', detected: 2 })
registerRecording(take)
const screenshotDoc = { ...DEFAULT_DOC, sourceId: 'image-names', capturedAt: 2 as const }

const active = () => liveShots().find((record) => record.id === store.get().activeId)!

beforeEach(() => vi.clearAllMocks())
afterEach(() => (mocks.naming.random = Math.random))

describe('the word lists', () => {
  it('hold about a hundred short, plain, lowercase words each, none twice and none in two lists', () => {
    const { adjectives, animals, fruits } = SHOT_NAME_WORDS
    for (const words of [adjectives, animals, fruits]) {
      expect(words.length).toBeGreaterThanOrEqual(90)
      expect(words.length).toBeLessThanOrEqual(110)
      expect(new Set(words).size).toBe(words.length)
      for (const word of words) expect(word).toMatch(/^[a-z]{1,10}$/)
    }
    expect(new Set([...adjectives, ...animals, ...fruits]).size).toBe(adjectives.length + animals.length + fruits.length)
  })

  it('include Mateusz’s own example', () => {
    expect(SHOT_NAME_WORDS.adjectives).toContain('diabolical')
    expect(SHOT_NAME_WORDS.animals).toContain('elephant')
    expect(SHOT_NAME_WORDS.fruits).toContain('strawberry')
  })

  it('leave out words that read badly side by side, and fruits few people know', () => {
    const { adjectives, animals, fruits } = SHOT_NAME_WORDS
    const words = [...adjectives, ...animals, ...fruits]
    const leftOut = ['gorilla', 'gibbon', 'silky', 'velvety']
    const littleKnown = ['salak', 'ackee', 'kiwano', 'pepino', 'quandong', 'lucuma', 'marula', 'mamey', 'haskap', 'pitanga', 'jostaberry', 'jabuticaba']
    for (const word of [...leftOut, ...littleKnown]) expect(words).not.toContain(word)
    expect(animals).toContain('raccoon')
  })

  it('can’t be changed by a caller', () => {
    expectTypeOf(SHOT_NAME_WORDS.adjectives).toEqualTypeOf<readonly string[]>()
    expectTypeOf(SHOT_NAME_WORDS.animals).toEqualTypeOf<readonly string[]>()
    expectTypeOf(SHOT_NAME_WORDS.fruits).toEqualTypeOf<readonly string[]>()
  })
})

describe('a random name', () => {
  it('is an adjective, an animal and a fruit, picked by the random source', () => {
    const { adjectives, animals, fruits } = SHOT_NAME_WORDS
    expect(randomShotName(scripted(0, 0, 0))).toBe(`${adjectives[0]}-${animals[0]}-${fruits[0]}`)
    expect(randomShotName(scripted(0.999999, 0.999999, 0.999999))).toBe(`${adjectives.at(-1)}-${animals.at(-1)}-${fruits.at(-1)}`)
    expect(isShotName(randomShotName())).toBe(true)
  })

  it('draws again until no shot has it', () => {
    const first = randomShotName(scripted(0, 0, 0))
    const second = randomShotName(scripted(0, 0, 0.5))
    expect(uniqueShotName(new Set([first]), scripted(0, 0, 0, 0, 0, 0.5))).toBe(second)
  })

  it('reads only three short lowercase words as a name', () => {
    expect(['diabolical-elephant-strawberry', 'a-b-c'].map(isShotName)).toEqual([true, true])
    for (const bad of ['', 'two-words', 'four-words-in-a', 'Upper-case-name', 'with-1-digit', '../evil-name-x', 'elevenletter-word-fig', 7, null]) {
      expect(isShotName(bad)).toBe(false)
    }
  })

  it('keeps the names shots ask for when they are free, and draws the rest so none repeats', () => {
    const first = randomShotName(scripted(0.5, 0.5, 0.5))
    const second = randomShotName(scripted(0.6, 0.6, 0.6))
    const random = scripted(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6, 0.6, 0.6)
    expect(settledShotNames(['brave-otter-fig', null, 'brave-otter-fig', 'calm-owl-date'], random)).toEqual([
      'brave-otter-fig',
      first,
      second,
      'calm-owl-date'
    ])
  })
})

describe('a shot’s name', () => {
  it('comes with every new shot', () => {
    for (let i = 0; i < 40; i++) addShot()
    const names = liveShots().map((record) => record.defaultName)
    expect(names.every(isShotName)).toBe(true)
    expect(new Set(names).size).toBe(names.length)
  })

  it('is drawn again when another shot has it', () => {
    mocks.naming.random = scripted(0.05, 0.05, 0.05)
    addShot()
    const taken = activeShotName()
    mocks.naming.random = scripted(0.05, 0.05, 0.05, 0.15, 0.15, 0.15)
    addShot()
    expect(activeShotName()).toBe(randomShotName(scripted(0.15, 0.15, 0.15)))
    expect(activeShotName()).not.toBe(taken)
  })

  it('makes no undo step and leaves an empty shot with nothing to save', () => {
    const unsavedBefore = unsavedCount()
    addShot()
    expect(store.get().past).toEqual([])
    expect(unsavedCount()).toBe(unsavedBefore)
  })

  it('stays through edits, undo and redo', () => {
    addShot(screenshotDoc)
    const name = activeShotName()
    updateDoc({ angle: 10 })
    setFileName('billing')
    undo()
    undo()
    redo()
    expect(activeShotName()).toBe(name)
    expect(active().defaultName).toBe(name)
  })

  it('stays through Reset this shot, on a screenshot and on a recording', () => {
    addShot(screenshotDoc)
    const screenshotName = activeShotName()
    updateDoc({ redactions: [{ id: 'box', rect: { x: 0, y: 0, w: 10, h: 10 }, time: null }] })
    resetAll()
    expect(activeShotName()).toBe(screenshotName)

    addShot(recordingDoc)
    const recordingName = activeShotName()
    updateDoc({ crop: { x: 0, y: 0, w: 640, h: 360 } })
    resetAll()
    expect(activeShotName()).toBe(recordingName)
  })

  it('comes back with a deleted shot, and no shot made meanwhile takes it', () => {
    mocks.naming.random = scripted(0.25, 0.25, 0.25)
    const id = addShot(screenshotDoc)
    const name = activeShotName()
    const removed = removeShots([id])!
    mocks.naming.random = scripted(0.25, 0.25, 0.25, 0.35, 0.35, 0.35)
    addShot()
    expect(activeShotName()).toBe(randomShotName(scripted(0.35, 0.35, 0.35)))
    restoreShots(removed)
    expect(activeShotName()).toBe(name)
    expect(liveShots().filter((record) => record.defaultName === name)).toHaveLength(1)
  })

  it('is the File name placeholder', () => {
    addShot()
    const s = store.get()
    expect(activeShotName(s)).toBe(s.shots.find((record) => record.id === s.activeId)!.defaultName)
  })
})

describe('export names', () => {
  it('use the shot’s name while the file name is empty, and the file name once there is one', async () => {
    addShot(screenshotDoc)
    const name = activeShotName()
    await exportImage()
    expect(mocks.saveImage).toHaveBeenLastCalledWith(expect.any(Blob), `${name}.webp`, 'webp')
    setFileName('Billing costs', true)
    await exportImage()
    expect(mocks.saveImage).toHaveBeenLastCalledWith(expect.any(Blob), 'billing-costs.webp', 'webp')
  })

  it('give each image in Export all its own shot’s name', async () => {
    addShot(screenshotDoc)
    addShot(screenshotDoc)
    await exportAll()
    const exported = mocks.saveImages.mock.calls[0][0].map(({ name }) => name)
    const expected = liveShots()
      .filter((record) => record.doc.sourceId !== null && record.doc.recording === null)
      .map((record) => `${slugify(record.doc.fileName) || record.defaultName}.webp`)
    expect(exported).toEqual(expected)
    expect(new Set(exported).size).toBe(exported.length)
  })

  it('name a recording’s MP4 after the shot', async () => {
    addShot(recordingDoc)
    store.set({ exportProgress: null })
    await exportRecording()
    expect(mocks.saveVideo).toHaveBeenCalledWith(expect.any(Uint8Array), `${activeShotName()}.mp4`)
  })

  it('end in .mp4 on a recording’s name tag, whatever the image format', () => {
    store.set({ format: 'png' })
    addShot(recordingDoc)
    expect(shotFileName(active())).toBe(`${activeShotName()}.mp4`)
    addShot(screenshotDoc)
    expect(shotFileName(active())).toBe(`${activeShotName()}.png`)
    store.set({ format: 'webp' })
  })
})

describe('names opened from a draft', () => {
  it('stay off the shots made afterwards', () => {
    const opened = randomShotName(scripted(0.45, 0.45, 0.45))
    applyOpenedDraft({ style: DEFAULT_HOUSE_STYLE, active: 0, shots: [{ kind: 'empty', defaultName: opened, doc: DEFAULT_DOC }] }, new Map(), new Map())
    expect(activeShotName()).toBe(opened)
    mocks.naming.random = scripted(0.45, 0.45, 0.45, 0.55, 0.55, 0.55)
    addShot()
    expect(activeShotName()).toBe(randomShotName(scripted(0.55, 0.55, 0.55)))
  })
})

describe('the old default names', () => {
  it('are gone from the app', () => {
    const sources = import.meta.glob<string>('../src/**/*', { query: '?raw', import: 'default', eager: true })
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    expect(Object.keys(sources).filter((path) => sources[path].includes('whats-new'))).toEqual([])
  })
})
