import { randomBytes, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, writeFileSync, type ReadStream, type WriteStream } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { crc32 } from 'node:zlib'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { ZipFile } from 'yazl'
import { DRAFT_LIMITS, DraftFileError, draftParts, readDraft, writeDraft, type DraftLimits, type DraftParts } from '../src/main/draft-file'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, createReadStream: vi.fn(actual.createReadStream), createWriteStream: vi.fn(actual.createWriteStream) }
})

const UUID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
const MANIFEST = '{"format":"cawmera-draft","version":1}'
const TRACK = '{"version":1}'
const png = new Uint8Array(randomBytes(4096))
const noop = () => {}
const text = (value: string) => new TextEncoder().encode(value)

/** Exactly what `partsIn` holds, so one byte or entry less refuses it. */
const AT_LIMITS: DraftLimits = {
  manifestBytes: MANIFEST.length,
  screenshotBytes: png.length,
  trackBytes: TRACK.length,
  bufferedBytes: MANIFEST.length + png.length + TRACK.length,
  entries: 4
}

const tempDirs: string[] = []

afterAll(() => Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3 }))))

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'cawmera-draft-'))
  tempDirs.push(dir)
  return dir
}

/** A destination that fails once more than `capacity` bytes reach it. */
function diskFullAfter(capacity: number) {
  let written = 0
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      written += chunk.length
      callback(written > capacity ? new Error('ENOSPC: no space left on device, write') : null)
    }
  }) as unknown as WriteStream
}

const reasonOf = (reading: Promise<unknown>) =>
  reading.then(
    () => null,
    (error: unknown) => (error instanceof DraftFileError ? error.reason : error)
  )

const takeFolders = async (root: string) => (existsSync(root) ? await readdir(root) : [])

const rising = (shares: number[]) => shares.every((share, i) => share >= 0 && share <= 1 && (i === 0 || share > shares[i - 1]))

async function workspace() {
  const dir = await tempDir()
  return { dir, root: join(dir, 'recordings'), newId: () => randomUUID() }
}

async function partsIn(dir: string, videoBytes = 100_000): Promise<DraftParts> {
  const video = join(dir, 'video.mp4')
  await writeFile(video, randomBytes(videoBytes))
  return { manifest: MANIFEST, screenshots: [{ key: 's1', bytes: png }], recordings: [{ key: 'r1', video, track: TRACK }] }
}

async function savedDraft(dir: string) {
  const target = join(dir, 'a.cawmera')
  await writeDraft(target, await partsIn(dir), noop)
  return target
}

interface HandEntry {
  name: string
  data?: Uint8Array
  method?: number
  crc?: number
}

interface Placed {
  offset: number
  size: number
  method: number
  crc: number
}

function centralRecord(name: string, { offset, size, method, crc }: Placed) {
  const record = Buffer.alloc(46)
  record.writeUInt32LE(0x02014b50, 0)
  record.writeUInt16LE(20, 6)
  record.writeUInt16LE(method, 10)
  record.writeUInt32LE(crc, 16)
  record.writeUInt32LE(size, 20)
  record.writeUInt32LE(size, 24)
  record.writeUInt16LE(Buffer.byteLength(name), 28)
  record.writeUInt32LE(offset, 42)
  return Buffer.concat([record, Buffer.from(name)])
}

/** A ZIP written byte by byte, for what yazl refuses to write. Each alias is one more central record for an earlier entry’s bytes. */
function handZip(entries: HandEntry[], aliases: { name: string; of: string }[] = []) {
  const parts: Uint8Array[] = []
  const records: Buffer[] = []
  const placed = new Map<string, Placed>()
  let offset = 0
  for (const { name, data = new Uint8Array(), method = 0, crc = crc32(data) } of entries) {
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(method, 8)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(Buffer.byteLength(name), 26)
    const entry = { offset, size: data.length, method, crc }
    placed.set(name, entry)
    records.push(centralRecord(name, entry))
    parts.push(header, Buffer.from(name), data)
    offset += header.length + Buffer.byteLength(name) + data.length
  }
  for (const alias of aliases) records.push(centralRecord(alias.name, placed.get(alias.of)!))
  const directory = Buffer.concat(records)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(records.length, 8)
  end.writeUInt16LE(records.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, directory, end])
}

async function handDraft(dir: string, entries: HandEntry[], aliases?: { name: string; of: string }[]) {
  const file = join(dir, `${randomUUID()}.cawmera`)
  await writeFile(file, handZip(entries, aliases))
  return file
}

const manifestEntry: HandEntry = { name: 'draft.json', data: text(MANIFEST) }

/** The work takes milliseconds, but opening a freshly written file has stalled for seconds on a busy PC. */
const ON_DISK = { timeout: 30_000 }

describe('writing and reading a draft', ON_DISK, () => {
  it('writes a draft and reads it back, streaming the video into a new take folder', async () => {
    const dir = await tempDir()
    const video = join(dir, 'video.mp4')
    await writeFile(video, randomBytes(3_000_000))
    const target = join(dir, 'a.cawmera')
    const progress: number[] = []
    await writeDraft(
      target,
      { manifest: MANIFEST, screenshots: [{ key: 's1', bytes: png }], recordings: [{ key: 'r1', video, track: TRACK }] },
      (share) => progress.push(share)
    )
    expect(progress.at(-1)).toBe(1)
    expect(rising(progress)).toBe(true)
    expect(existsSync(`${target}.partial`)).toBe(false)
    const root = join(dir, 'recordings')
    const readProgress: number[] = []
    const opened = await readDraft(target, root, () => UUID, (share) => readProgress.push(share))
    expect(opened.manifest).toBe(MANIFEST)
    expect(opened.screenshots).toEqual([{ key: 's1', bytes: png }])
    expect(opened.recordings).toEqual([{ key: 'r1', id: UUID, track: TRACK }])
    expect((await readFile(join(root, UUID, 'video.mp4'))).equals(await readFile(video))).toBe(true)
    expect(readProgress.at(-1)).toBe(1)
    expect(rising(readProgress)).toBe(true)
  })

  it('removes the partial file when a recording’s video is gone, and keeps the draft it would replace', async () => {
    const { dir } = await workspace()
    const target = join(dir, 'a.cawmera')
    await writeFile(target, 'the previous draft')
    const parts = await partsIn(dir)
    await expect(
      writeDraft(target, { ...parts, recordings: [{ key: 'r1', video: join(dir, 'missing.mp4'), track: '{}' }] }, noop)
    ).rejects.toThrow()
    expect(existsSync(`${target}.partial`)).toBe(false)
    expect(await readFile(target, 'utf8')).toBe('the previous draft')
  })

  it('refuses to write a draft it couldn’t open again', async () => {
    const { dir } = await workspace()
    const parts = await partsIn(dir)
    const target = join(dir, 'a.cawmera')
    const refusals: [DraftParts, DraftLimits, string][] = [
      [{ ...parts, screenshots: [{ key: 'Shot-1', bytes: png }] }, AT_LIMITS, 'The draft key “Shot-1” is invalid or repeated'],
      [{ ...parts, screenshots: [{ key: 's1', bytes: png }, { key: 's1', bytes: png }] }, DRAFT_LIMITS, 'The draft key “s1” is invalid or repeated'],
      [parts, { ...AT_LIMITS, manifestBytes: MANIFEST.length - 1 }, `draft.json is over ${MANIFEST.length - 1} bytes`],
      [parts, { ...AT_LIMITS, screenshotBytes: png.length - 1 }, `screenshots/s1.png is over ${png.length - 1} bytes`],
      [parts, { ...AT_LIMITS, trackBytes: TRACK.length - 1 }, `recordings/r1/track.json is over ${TRACK.length - 1} bytes`],
      [
        parts,
        { ...AT_LIMITS, bufferedBytes: AT_LIMITS.bufferedBytes - 1 },
        `The manifest, screenshots and tracks are over ${AT_LIMITS.bufferedBytes - 1} bytes together`
      ],
      [parts, { ...AT_LIMITS, entries: 3 }, 'A draft holds at most 3 entries']
    ]
    for (const [refused, limits, message] of refusals) await expect(writeDraft(target, refused, noop, limits)).rejects.toThrow(message)
    expect(existsSync(target) || existsSync(`${target}.partial`)).toBe(false)
    await writeDraft(target, parts, noop, AT_LIMITS)
    expect(existsSync(target)).toBe(true)
  })

  it('closes the video it was reading and removes the partial file when the disk fills up partway', async () => {
    const { dir } = await workspace()
    const parts = await partsIn(dir, 3_000_000)
    const target = join(dir, 'a.cawmera')
    await writeFile(target, 'the previous draft')
    vi.mocked(createReadStream).mockClear()
    vi.mocked(createWriteStream).mockImplementationOnce((path) => {
      writeFileSync(path, 'the first megabyte')
      return diskFullAfter(1_000_000)
    })
    await expect(writeDraft(target, parts, noop)).rejects.toThrow('ENOSPC')
    const sources = vi.mocked(createReadStream).mock.results.map(({ value }) => value as ReadStream)
    expect(sources).toHaveLength(1)
    await vi.waitFor(() => expect(sources[0].closed).toBe(true))
    expect(existsSync(`${target}.partial`)).toBe(false)
    expect(await readFile(target, 'utf8')).toBe('the previous draft')
  })
})

describe('reading a draft from anyone', ON_DISK, () => {
  it('refuses a file that isn’t a draft, and a damaged one', async () => {
    const { dir, root, newId } = await workspace()
    const textFile = join(dir, 'notes.cawmera')
    await writeFile(textFile, 'Not a draft')
    const emptyFile = join(dir, 'empty.cawmera')
    await writeFile(emptyFile, '')
    const foreignZip = await handDraft(dir, [{ name: 'word/document.xml', data: text('<w:document/>') }])
    const truncatedDraft = join(dir, 'truncated.cawmera')
    await writeFile(truncatedDraft, (await readFile(await savedDraft(dir))).subarray(0, 50_000))
    for (const file of [textFile, emptyFile, foreignZip]) expect(await reasonOf(readDraft(file, root, newId, noop))).toBe('not-a-draft')
    expect(await reasonOf(readDraft(truncatedDraft, root, newId, noop))).toBe('damaged')
    expect(await reasonOf(readDraft(join(dir, 'missing.cawmera'), root, newId, noop))).toBe('unreadable')
    expect(await takeFolders(root)).toEqual([])
  })

  it('refuses entry names outside the layout and writes nothing outside the take folder', async () => {
    const { dir, root, newId } = await workspace()
    const names = ['../escape.txt', 'recordings/../../escape/video.mp4', '/escape.txt', 'C:/escape.txt', 'recordings\\..\\..\\escape.txt']
    const drafts = []
    for (const name of names) drafts.push(await handDraft(dir, [manifestEntry, { name, data: text('escaped') }]))
    const filesBefore = await readdir(dir, { recursive: true })
    for (const draftWithDotDotEntry of drafts) expect(await reasonOf(readDraft(draftWithDotDotEntry, root, newId, noop))).toBe('damaged')
    expect(await readdir(dir, { recursive: true })).toEqual(filesBefore)
  })

  it('refuses a manifest over its limit', async () => {
    const { dir, root, newId } = await workspace()
    const hugeManifestDraft = await savedDraft(dir)
    expect(await reasonOf(readDraft(hugeManifestDraft, root, newId, noop, { ...DRAFT_LIMITS, manifestBytes: MANIFEST.length - 1 }))).toBe('too-large')
  })

  it('refuses parts, their total and entries over the limits before reading anything, and opens a draft right at them', async () => {
    const { dir, root, newId } = await workspace()
    const draft = await savedDraft(dir)
    const overs = [{ screenshotBytes: png.length - 1 }, { trackBytes: TRACK.length - 1 }, { bufferedBytes: AT_LIMITS.bufferedBytes - 1 }, { entries: 3 }]
    for (const over of overs) expect(await reasonOf(readDraft(draft, root, newId, noop, { ...AT_LIMITS, ...over }))).toBe('too-large')
    expect(await takeFolders(root)).toEqual([])
    expect((await readDraft(draft, root, newId, noop, AT_LIMITS)).recordings).toHaveLength(1)
  })

  it('reads a draft written in ZIP64', async () => {
    const { dir, root } = await workspace()
    const file = join(dir, 'zip64.cawmera')
    const video = randomBytes(100_000)
    const zip = new ZipFile()
    const forced = { compress: false, forceZip64Format: true }
    zip.addBuffer(Buffer.from(MANIFEST), 'draft.json', forced)
    zip.addBuffer(Buffer.from(png), 'screenshots/s1.png', forced)
    zip.addBuffer(video, 'recordings/r1/video.mp4', forced)
    zip.addBuffer(Buffer.from(TRACK), 'recordings/r1/track.json', forced)
    zip.end({ forceZip64Format: true, comment: '' })
    await pipeline(zip.outputStream, createWriteStream(file))
    expect((await readFile(file)).includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(true)
    const opened = await readDraft(file, root, () => UUID, noop)
    expect(opened).toEqual({ manifest: MANIFEST, screenshots: [{ key: 's1', bytes: png }], recordings: [{ key: 'r1', id: UUID, track: TRACK }] })
    expect((await readFile(join(root, UUID, 'video.mp4'))).equals(video)).toBe(true)
  })

  it('ignores unknown entries and keys that don’t fit', async () => {
    const { dir, root, newId } = await workspace()
    const ignored = [
      'screenshots/S2.png',
      'screenshots/s-3.png',
      'screenshots/abcdefghijklmnopq.png',
      'screenshots/nested/s4.png',
      'screenshots/s5.webp',
      'recordings/BAD/video.mp4',
      'recordings/r1/notes.txt',
      'thumbnails/s1.png',
      'mimetype'
    ]
    const draft = await handDraft(dir, [manifestEntry, { name: 'screenshots/s1.png', data: png }, ...ignored.map((name) => ({ name, data: png }))])
    const opened = await readDraft(draft, root, newId, noop)
    expect(opened).toEqual({ manifest: MANIFEST, screenshots: [{ key: 's1', bytes: png }], recordings: [] })
    expect(await takeFolders(root)).toEqual([])
  })

  it('refuses compressed entries, repeated names, shared bytes, half a recording and a wrong CRC-32', async () => {
    const { dir, root, newId } = await workspace()
    const screenshot: HandEntry = { name: 'screenshots/s1.png', data: png }
    const damaged = [
      await handDraft(dir, [{ ...manifestEntry, method: 8 }]),
      await handDraft(dir, [manifestEntry, screenshot, screenshot]),
      await handDraft(dir, [manifestEntry, screenshot], [{ name: 'screenshots/s2.png', of: 'screenshots/s1.png' }]),
      await handDraft(dir, [manifestEntry, { name: 'recordings/r1/video.mp4', data: text('video') }]),
      await handDraft(dir, [manifestEntry, { name: 'recordings/r1/track.json', data: text(TRACK) }]),
      await handDraft(dir, [manifestEntry, { ...screenshot, crc: 1234 }])
    ]
    for (const file of damaged) expect(await reasonOf(readDraft(file, root, newId, noop))).toBe('damaged')
    expect(await takeFolders(root)).toEqual([])
  })

  it('removes every take folder it made when a video fails its CRC-32', async () => {
    const { dir, root, newId } = await workspace()
    const draft = await handDraft(dir, [
      manifestEntry,
      { name: 'recordings/r1/track.json', data: text(TRACK) },
      { name: 'recordings/r1/video.mp4', data: randomBytes(200_000) },
      { name: 'recordings/r2/track.json', data: text(TRACK) },
      { name: 'recordings/r2/video.mp4', data: randomBytes(200_000), crc: 1234 }
    ])
    expect(await reasonOf(readDraft(draft, root, newId, noop))).toBe('damaged')
    expect(await takeFolders(root)).toEqual([])
  })
})

describe('draft parts from the renderer', () => {
  const folder = join(tmpdir(), 'cawmera-takes', UUID)
  const takeFolder = (id: string) => (id === UUID ? folder : null)
  const files = { manifest: MANIFEST, screenshots: [{ key: 's1', bytes: png }], recordings: [{ key: 'r1', id: UUID, track: TRACK }] }

  it('copies a recording only from a known take, found by its id', () => {
    const withPath = { ...files, recordings: [{ ...files.recordings[0], video: 'C:\\Users\\someone\\secret.mp4' }] }
    expect(draftParts(withPath, takeFolder)).toEqual({
      manifest: MANIFEST,
      screenshots: [{ key: 's1', bytes: png }],
      recordings: [{ key: 'r1', video: join(folder, 'video.mp4'), track: TRACK }]
    })
    expect(() => draftParts({ ...files, recordings: [{ key: 'r1', id: randomUUID(), track: TRACK }] }, takeFolder)).toThrow(
      'A recording in this draft is no longer available'
    )
  })

  it('refuses parts it couldn’t open again, before anything asks where to save', () => {
    expect(() => draftParts({ ...files, screenshots: [{ key: 'Image-1', bytes: png }] }, takeFolder)).toThrow('The draft key “Image-1” is invalid or repeated')
    expect(() => draftParts(files, takeFolder, { ...DRAFT_LIMITS, screenshotBytes: png.length - 1 })).toThrow(`screenshots/s1.png is over ${png.length - 1} bytes`)
  })

  it('refuses files of the wrong shape', () => {
    const malformed: unknown[] = [
      null,
      'files',
      { ...files, manifest: 1 },
      { ...files, screenshots: {} },
      { ...files, screenshots: [{ key: 's1', bytes: [1, 2, 3] }] },
      { ...files, recordings: [{ key: 'r1', id: UUID }] },
      { ...files, recordings: [{ key: 1, id: UUID, track: TRACK }] }
    ]
    for (const bad of malformed) expect(() => draftParts(bad, takeFolder)).toThrow('The draft’s files are malformed')
  })
})
