import { createReadStream, createWriteStream, type ReadStream } from 'node:fs'
import { lstat, mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { crc32 } from 'node:zlib'
import { openPromise, type Entry, type ZipFile as ZipReader } from 'yauzl'
import { ZipFile as ZipWriter } from 'yazl'
import { DRAFT_KEY } from '../shared/draft-key'
import type { DraftFiles, DraftOpenFailure } from '../shared/types'
import { recordingDir, removeRecording } from './recording-files'

/** Far above any draft Cawmera writes: 500 shots make at most 1,001 entries. */
export const DRAFT_LIMITS = {
  manifestBytes: 50_000_000,
  screenshotBytes: 200_000_000,
  trackBytes: 200_000_000,
  bufferedBytes: 1_000_000_000,
  entries: 5_000
}

export type DraftLimits = typeof DRAFT_LIMITS

export interface DraftParts {
  manifest: string
  screenshots: { key: string; bytes: Uint8Array }[]
  recordings: { key: string; video: string; track: string }[]
}

export class DraftFileError extends Error {
  constructor(
    readonly reason: DraftOpenFailure,
    message: string
  ) {
    super(message)
    this.name = 'DraftFileError'
  }
}

const MANIFEST = 'draft.json'
const screenshotName = (key: string) => `screenshots/${key}.png`
const videoName = (key: string) => `recordings/${key}/video.mp4`
const trackName = (key: string) => `recordings/${key}/track.json`
const SCREENSHOT_NAME = /^screenshots\/([^/]+)\.png$/
const RECORDING_NAME = /^recordings\/([^/]+)\/(video\.mp4|track\.json)$/
const LOCAL_FILE_HEADER = 0x04034b50
const TAKE_VIDEO = 'video.mp4'

type Part = { kind: 'manifest' } | { kind: 'screenshot' | 'video' | 'track'; key: string }

interface KnownEntry {
  part: Part
  entry: Entry
}

interface Layout {
  manifest: Entry
  screenshots: { key: string; entry: Entry }[]
  recordings: { key: string; video: Entry; track: Entry }[]
}

const damaged = (message: string) => new DraftFileError('damaged', message)

const overLimit = (name: string, limit: number) => `${name} is over ${limit} bytes`

const overBufferedLimit = (limit: number) => `The manifest, screenshots and tracks are over ${limit} bytes together`

const LAST_PERCENT_BEFORE_DONE = 99

function progressReporter(onProgress: (share: number) => void) {
  let percent = -1
  return (done: number, total: number) => {
    if (total <= 0) return
    const next = Math.min(LAST_PERCENT_BEFORE_DONE, Math.floor((done / total) * 100))
    if (next <= percent) return
    percent = next
    onProgress(next / 100)
  }
}

function assertKeys(keys: string[]) {
  const seen = new Set<string>()
  for (const key of keys) {
    if (!DRAFT_KEY.test(key) || seen.has(key)) throw new Error(`The draft key “${key}” is invalid or repeated`)
    seen.add(key)
  }
}

function assertWithin(size: number, limit: number, message: string) {
  if (size > limit) throw new Error(message)
}

/** What the reader would refuse is never written: a draft that can't be opened again loses the work in it. */
function assertReadable({ manifest, screenshots, recordings }: DraftParts, limits: DraftLimits) {
  assertKeys(screenshots.map(({ key }) => key))
  assertKeys(recordings.map(({ key }) => key))
  let buffered = Buffer.byteLength(manifest)
  assertWithin(buffered, limits.manifestBytes, overLimit(MANIFEST, limits.manifestBytes))
  for (const { key, bytes } of screenshots) {
    assertWithin(bytes.byteLength, limits.screenshotBytes, overLimit(screenshotName(key), limits.screenshotBytes))
    buffered += bytes.byteLength
  }
  for (const { key, track } of recordings) {
    const trackBytes = Buffer.byteLength(track)
    assertWithin(trackBytes, limits.trackBytes, overLimit(trackName(key), limits.trackBytes))
    buffered += trackBytes
  }
  assertWithin(buffered, limits.bufferedBytes, overBufferedLimit(limits.bufferedBytes))
  assertWithin(1 + screenshots.length + 2 * recordings.length, limits.entries, `A draft holds at most ${limits.entries} entries`)
}

const bufferOf = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

export const partialFileOf = (target: string) => `${target}.partial`

async function regularFileSize(path: string) {
  const info = await stat(path)
  if (!info.isFile()) throw new Error(`${path} isn’t a file`)
  return info.size
}

async function removePartial(partial: string) {
  const info = await lstat(partial).catch(() => null)
  // `recursive` only so that Node retries while antivirus holds the fresh file; the path is a file.
  if (info?.isFile()) await rm(partial, { recursive: true, force: true, maxRetries: 3 })
}

export async function writeDraft(
  target: string,
  parts: DraftParts,
  onProgress: (share: number) => void,
  limits: DraftLimits = DRAFT_LIMITS
): Promise<void> {
  assertReadable(parts, limits)
  const videoSizes = await Promise.all(parts.recordings.map(({ video }) => regularFileSize(video)))
  const report = progressReporter(onProgress)
  let written = 0
  let total = 0
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.length
      report(written, total)
      callback(null, chunk)
    }
  })
  const sources: ReadStream[] = []
  const zip = new ZipWriter()
  zip.on('error', (error: Error) => counter.destroy(error))
  const stored = { compress: false }
  zip.addBuffer(Buffer.from(parts.manifest), MANIFEST, stored)
  for (const { key, bytes } of parts.screenshots) zip.addBuffer(bufferOf(bytes), screenshotName(key), stored)
  for (const [index, { key, video, track }] of parts.recordings.entries()) {
    zip.addReadStreamLazy(videoName(key), { ...stored, size: videoSizes[index] }, (callback) => {
      const source = createReadStream(video)
      source.on('error', (error) => counter.destroy(error))
      sources.push(source)
      callback(null, source)
    })
    zip.addBuffer(Buffer.from(track), trackName(key), stored)
  }
  // yazl calls back with the archive's final size; its typings leave the argument out.
  zip.end(undefined, ((size: number) => {
    total = size
  }) as () => void)
  const partial = partialFileOf(target)
  try {
    await pipeline(zip.outputStream, counter, createWriteStream(partial))
    await rename(partial, target)
  } catch (error) {
    for (const source of sources) source.destroy()
    await removePartial(partial).catch(() => {})
    throw error
  }
  onProgress(1)
}

async function startsLikeZip(file: string) {
  const handle = await open(file, 'r')
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(4), 0, 4, 0)
    return bytesRead === 4 && buffer.readUInt32LE(0) === LOCAL_FILE_HEADER
  } finally {
    await handle.close()
  }
}

function partOf(name: string): Part | null {
  if (name === MANIFEST) return { kind: 'manifest' }
  const screenshot = SCREENSHOT_NAME.exec(name)
  if (screenshot && DRAFT_KEY.test(screenshot[1])) return { kind: 'screenshot', key: screenshot[1] }
  const recording = RECORDING_NAME.exec(name)
  if (recording && DRAFT_KEY.test(recording[1])) return { kind: recording[2] === 'video.mp4' ? 'video' : 'track', key: recording[1] }
  return null
}

/** Reads the central directory only; yauzl refuses absolute and `..` names on the way. */
function scanEntries(zip: ZipReader, limits: DraftLimits): Promise<KnownEntry[]> {
  return new Promise((resolve, reject) => {
    zip.on('error', reject)
    if (zip.entryCount > limits.entries) return reject(new DraftFileError('too-large', `The file holds over ${limits.entries} entries`))
    const known: KnownEntry[] = []
    zip.on('entry', (entry: Entry) => {
      const part = partOf(entry.fileName)
      if (part) known.push({ part, entry })
      zip.readEntry()
    })
    zip.on('end', () => resolve(known))
    zip.readEntry()
  })
}

/** Entries that share bytes could make a small file read as many large ones. */
function assertSound(known: KnownEntry[], fileSize: number) {
  const names = new Set<string>()
  let claimed = 0
  for (const { entry } of known) {
    if (names.has(entry.fileName)) throw damaged(`${entry.fileName} appears twice`)
    names.add(entry.fileName)
    if (entry.compressionMethod !== 0 || entry.isEncrypted()) throw damaged(`${entry.fileName} isn’t stored uncompressed`)
    claimed += entry.compressedSize
  }
  if (claimed > fileSize) throw damaged('The entries claim more bytes than the file holds')
}

function recordingsOf(known: KnownEntry[]): Layout['recordings'] {
  const byKey = new Map<string, { video?: Entry; track?: Entry }>()
  for (const { part, entry } of known) {
    if (part.kind === 'video' || part.kind === 'track') byKey.set(part.key, { ...byKey.get(part.key), [part.kind]: entry })
  }
  return [...byKey].map(([key, { video, track }]) => {
    if (!video || !track) throw damaged(`Recording ${key} has no ${video ? 'track' : 'video'}`)
    return { key, video, track }
  })
}

function bufferLimit(part: Part, limits: DraftLimits) {
  if (part.kind === 'manifest') return limits.manifestBytes
  if (part.kind === 'screenshot') return limits.screenshotBytes
  if (part.kind === 'track') return limits.trackBytes
  return null
}

function assertBufferable(known: KnownEntry[], limits: DraftLimits) {
  let buffered = 0
  for (const { part, entry } of known) {
    const limit = bufferLimit(part, limits)
    if (limit === null) continue
    if (entry.uncompressedSize > limit) throw new DraftFileError('too-large', overLimit(entry.fileName, limit))
    buffered += entry.uncompressedSize
  }
  if (buffered > limits.bufferedBytes) throw new DraftFileError('too-large', overBufferedLimit(limits.bufferedBytes))
}

function layoutOf(known: KnownEntry[], fileSize: number, limits: DraftLimits): Layout {
  const manifest = known.find(({ part }) => part.kind === 'manifest')
  if (!manifest) throw new DraftFileError('not-a-draft', `There’s no ${MANIFEST}`)
  assertSound(known, fileSize)
  const screenshots = known.flatMap(({ part, entry }) => (part.kind === 'screenshot' ? [{ key: part.key, entry }] : []))
  const recordings = recordingsOf(known)
  assertBufferable(known, limits)
  return { manifest: manifest.entry, screenshots, recordings }
}

/** yauzl leaves the CRC-32 to its caller. */
async function* verifiedChunks(zip: ZipReader, entry: Entry, advance: (bytes: number) => void): AsyncGenerator<Buffer> {
  let size = 0
  let crc = 0
  for await (const chunk of (await zip.openReadStreamPromise(entry)) as AsyncIterable<Buffer>) {
    size += chunk.length
    crc = crc32(chunk, crc)
    advance(chunk.length)
    yield chunk
  }
  if (size !== entry.uncompressedSize || crc !== entry.crc32) throw damaged(`${entry.fileName} doesn’t match its size or CRC-32`)
}

async function bytesOf(zip: ZipReader, entry: Entry, advance: (bytes: number) => void) {
  const bytes = new Uint8Array(entry.uncompressedSize)
  let filled = 0
  for await (const chunk of verifiedChunks(zip, entry, advance)) {
    bytes.set(chunk, filled)
    filled += chunk.length
  }
  return bytes
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

function textOf(bytes: Uint8Array, name: string) {
  try {
    return utf8.decode(bytes)
  } catch {
    throw damaged(`${name} isn’t UTF-8 text`)
  }
}

async function extract(
  zip: ZipReader,
  layout: Layout,
  recordingsRoot: string,
  newId: () => string,
  onProgress: (share: number) => void
): Promise<DraftFiles> {
  const report = progressReporter(onProgress)
  const entries = [layout.manifest, ...layout.screenshots.map(({ entry }) => entry), ...layout.recordings.flatMap(({ video, track }) => [video, track])]
  const total = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0)
  let done = 0
  const advance = (bytes: number) => {
    done += bytes
    report(done, total)
  }
  const manifest = textOf(await bytesOf(zip, layout.manifest, advance), MANIFEST)
  const screenshots: DraftFiles['screenshots'] = []
  for (const { key, entry } of layout.screenshots) screenshots.push({ key, bytes: await bytesOf(zip, entry, advance) })
  const tracks: string[] = []
  for (const { track } of layout.recordings) tracks.push(textOf(await bytesOf(zip, track, advance), track.fileName))
  const created: string[] = []
  try {
    const recordings: DraftFiles['recordings'] = []
    for (const [index, { key, video }] of layout.recordings.entries()) {
      const id = newId()
      const folder = recordingDir(recordingsRoot, id)
      await mkdir(recordingsRoot, { recursive: true })
      await mkdir(folder)
      created.push(id)
      await pipeline(verifiedChunks(zip, video, advance), createWriteStream(join(folder, TAKE_VIDEO), { flags: 'wx' }))
      recordings.push({ key, id, track: tracks[index] })
    }
    onProgress(1)
    return { manifest, screenshots, recordings }
  } catch (error) {
    await Promise.all(created.map((id) => removeRecording(recordingsRoot, id).catch(() => {})))
    throw error
  }
}

function asDraftFileError(error: unknown) {
  if (error instanceof DraftFileError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new DraftFileError(error instanceof Error && 'syscall' in error ? 'unreadable' : 'damaged', message)
}

/**
 * `file` can come from anyone. Unknown entries and keys that fail DRAFT_KEY are skipped, limits apply before any
 * bytes are buffered, and nothing is written outside `<recordingsRoot>/<newId()>/`. Each recording's video lands
 * in such a new take folder, which the caller adopts; a failed read removes them all.
 */
export async function readDraft(
  file: string,
  recordingsRoot: string,
  newId: () => string,
  onProgress: (share: number) => void,
  limits: DraftLimits = DRAFT_LIMITS
): Promise<DraftFiles> {
  try {
    if (!(await startsLikeZip(file))) throw new DraftFileError('not-a-draft', 'The file isn’t a ZIP archive')
    const zip = await openPromise(file, { autoClose: false })
    try {
      const layout = layoutOf(await scanEntries(zip, limits), zip.fileSize, limits)
      return await extract(zip, layout, recordingsRoot, newId, onProgress)
    } finally {
      zip.close()
    }
  } catch (error) {
    throw asDraftFileError(error)
  }
}

type Fields = Record<string, unknown>

const fieldsOf = (value: unknown): Fields => (typeof value === 'object' && value !== null ? (value as Fields) : {})

const malformed = () => new Error('The draft’s files are malformed')

/**
 * The renderer names takes by id only; a video's path always comes from `takeFolder`, which knows only finished and
 * adopted takes. Everything writeDraft would refuse is refused here already, before anyone picks where to save.
 */
export function draftParts(files: unknown, takeFolder: (id: string) => string | null, limits: DraftLimits = DRAFT_LIMITS): DraftParts {
  const { manifest, screenshots, recordings } = fieldsOf(files)
  if (typeof manifest !== 'string' || !Array.isArray(screenshots) || !Array.isArray(recordings)) throw malformed()
  const parts = {
    manifest,
    screenshots: screenshots.map((screenshot: unknown) => {
      const { key, bytes } = fieldsOf(screenshot)
      if (typeof key !== 'string' || !(bytes instanceof Uint8Array)) throw malformed()
      return { key, bytes }
    }),
    recordings: recordings.map((recording: unknown) => {
      const { key, id, track } = fieldsOf(recording)
      if (typeof key !== 'string' || typeof id !== 'string' || typeof track !== 'string') throw malformed()
      const folder = takeFolder(id)
      if (!folder) throw new Error('A recording in this draft is no longer available')
      return { key, video: join(folder, TAKE_VIDEO), track }
    })
  }
  assertReadable(parts, limits)
  return parts
}
