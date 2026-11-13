import {
  DEFAULT_DOC,
  DEFAULT_SPOTLIGHT,
  isEdge,
  normalizeAngle,
  snapDensity,
  UI_ZOOMS,
  type Density,
  type Doc,
  type Fill,
  type RedactStyle,
  type Redaction,
  type Spotlight
} from '../app/doc'
import { DEFAULT_HOUSE_STYLE, loadHouseStyle, serializeHouseStyle, type HouseStyle } from '../app/house-style'
import { clampSide, evenSize } from '../app/size'
import { DRAFT_KEY } from '@shared/draft-key'
import { getSource, type ShotRecord, type SourceEntry } from '../app/store'
import { clamp, clipTo, type Rect, type Size } from '../render/geometry'
import { settleSelection } from '../render/layout'
import { settledBoxTime } from '../recording/blur-boxes'
import { settleRecordingCrop } from '../recording/crop'
import type { CursorLook } from '../recording/cursor-art'
import type { ClickEffect } from '../recording/effects'
import type { ZoomSpeed } from '../recording/camera'
import { normalizePieces } from '../recording/pieces'
import { CURSOR_SIZE_RANGE, DEFAULT_RECORDING, type RecordingDoc, type RecordingFps } from '../recording/settings'
import { clampTrim, type Trim } from '../recording/trim'
import { parseTrack, type RecordingTrack } from '../recording/track'
import { normalizeZoomEdits } from '../recording/zoom-edits'

export const DRAFT_FORMAT = 'cawmera-draft'
export const DRAFT_VERSION = 1

/** `too-large` comes from opening, not parsing: the screenshots would decode past what one canvas may hold. */
export type DraftFailure = 'not-a-draft' | 'newer-version' | 'damaged' | 'too-large'

export class DraftError extends Error {
  constructor(readonly reason: DraftFailure) {
    super(`Draft ${reason}`)
    this.name = 'DraftError'
  }
}

export type DraftShot =
  | { kind: 'empty'; doc: Doc }
  | { kind: 'screenshot'; key: string; doc: Doc; source: { name: string; origin: SourceEntry['origin']; detected: Density } }
  | { kind: 'recording'; key: string; doc: Doc; name: string }

/** `doc.sourceId` holds the key. */
export interface DraftContents {
  style: HouseStyle
  active: number
  shots: DraftShot[]
}

/** The takes' tracks by key: a map, or a reader that reads a track only once a shot asks for it. */
export type DraftTracks = Pick<ReadonlyMap<string, RecordingTrack>, 'get'>

const ORIGINS: SourceEntry['origin'][] = ['paste', 'drop', 'file', 'capture']
const REDACT_STYLES: RedactStyle[] = ['blur', 'pixelate', 'solid']
const FILLS: Fill[] = ['gradient', 'image']
const LOOKS: CursorLook[] = ['light', 'dark']
const CLICK_EFFECTS: ClickEffect[] = ['off', 'ring', 'ripple']
const ZOOM_SPEEDS: ZoomSpeed[] = ['calm', 'quick']
const FPS_CHOICES: RecordingFps[] = [30, 60]
/** Far above what Cawmera makes itself; a manifest past them is damaged. */
export const DRAFT_LIMITS = { shots: 500, redactions: 2000, zooms: 1000, pieces: 5000 }
/** Far above any take Cawmera records; a track past one is damaged. */
export const DRAFT_TRACK_BOUNDS = { durationMs: 4 * 60 * 60 * 1000, side: 16_384, fps: 240 }

const docFitsDraftLimits = ({ redactions, recording }: Doc) =>
  redactions.length <= DRAFT_LIMITS.redactions &&
  (!recording || ((recording.zooms?.length ?? 0) <= DRAFT_LIMITS.zooms && recording.pieces.length <= DRAFT_LIMITS.pieces))

/** A draft past DRAFT_LIMITS couldn't be opened again, so its shots are checked before it's written. */
export const fitsDraftLimits = (shots: ShotRecord[]): boolean => shots.length <= DRAFT_LIMITS.shots && shots.every(({ doc }) => docFitsDraftLimits(doc))
const MAX_NAME_LENGTH = 200
const HEX = /^#[0-9a-f]{6}$/i

type Fields = Record<string, unknown>

const fieldsOf = (value: unknown): Fields => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : {})
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const oneOf = <T>(choices: readonly T[], value: unknown, fallback: T): T => (choices.includes(value as T) ? (value as T) : fallback)
const boolean = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)
const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value.slice(0, MAX_NAME_LENGTH) : fallback)
const numberIn = (value: unknown, min: number, max: number, fallback: number) => (isFiniteNumber(value) ? clamp(value, min, max) : fallback)

function withinLimit(value: unknown, limit: number): void {
  if (Array.isArray(value) && value.length > limit) throw new DraftError('damaged')
}

function rectOf(value: unknown): Rect | null {
  const { x, y, w, h } = fieldsOf(value)
  return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(w) && isFiniteNumber(h) ? { x, y, w, h } : null
}

function rectWithin(value: unknown, bounds: Size | null): Rect | null {
  const rect = rectOf(value)
  if (!rect || !bounds) return null
  const clipped = clipTo(rect, { x: 0, y: 0, w: bounds.width, h: bounds.height })
  return clipped.w > 0 && clipped.h > 0 ? clipped : null
}

function spanOf(value: unknown): { start: number; end: number } | null {
  const { start, end } = fieldsOf(value)
  return isFiniteNumber(start) && isFiniteNumber(end) && end > start ? { start, end } : null
}

function trimOf(value: unknown, durationMs: number): Trim {
  const { start, end } = fieldsOf(value)
  return clampTrim(isFiniteNumber(start) && isFiniteNumber(end) ? { start, end } : { start: 0, end: durationMs }, durationMs)
}

function recordingDocFrom(value: unknown, track: RecordingTrack): RecordingDoc {
  const raw = fieldsOf(value)
  withinLimit(raw.pieces, DRAFT_LIMITS.pieces)
  withinLimit(raw.zooms, DRAFT_LIMITS.zooms)
  const trim = trimOf(raw.trim, track.durationMs)
  const defaults = DEFAULT_RECORDING
  return {
    trim,
    pieces: normalizePieces(raw.pieces, track.durationMs),
    zooms: normalizeZoomEdits(raw.zooms, track.durationMs)?.map((edit) => ({ ...edit, focus: { x: clamp(edit.focus.x, 0, track.width), y: clamp(edit.focus.y, 0, track.height) } })) ?? null,
    cursorSize: numberIn(raw.cursorSize, CURSOR_SIZE_RANGE.min, CURSOR_SIZE_RANGE.max, defaults.cursorSize),
    smoothing: numberIn(raw.smoothing, 0, 1, defaults.smoothing),
    look: oneOf(LOOKS, raw.look, defaults.look),
    clickEffect: oneOf(CLICK_EFFECTS, raw.clickEffect, defaults.clickEffect),
    hideWhenStill: boolean(raw.hideWhenStill, defaults.hideWhenStill),
    tilt: boolean(raw.tilt, defaults.tilt),
    cursorBlur: numberIn(raw.cursorBlur, 0, 1, defaults.cursorBlur),
    cameraBlur: numberIn(raw.cameraBlur, 0, 1, defaults.cameraBlur),
    zoomSpeed: oneOf(ZOOM_SPEEDS, raw.zoomSpeed, defaults.zoomSpeed),
    fps: oneOf(FPS_CHOICES, raw.fps, defaults.fps)
  }
}

function spotlightFrom(value: unknown, bounds: Size | null): Spotlight {
  const raw = fieldsOf(value)
  return {
    on: raw.on === true,
    rect: rectWithin(raw.rect, bounds),
    dim: numberIn(raw.dim, 0, 1, DEFAULT_SPOTLIGHT.dim),
    outline: boolean(raw.outline, DEFAULT_SPOTLIGHT.outline)
  }
}

function redactionsFrom(value: unknown, bounds: Size | null, track: RecordingTrack | null): Redaction[] {
  withinLimit(value, DRAFT_LIMITS.redactions)
  if (!bounds || !Array.isArray(value)) return []
  const ids = new Set<string>()
  const redactions: Redaction[] = []
  for (const entry of value) {
    const { id, rect, time } = fieldsOf(entry)
    const clipped = rectWithin(rect, bounds)
    if (typeof id !== 'string' || id === '' || ids.has(id) || !clipped) continue
    const span = spanOf(time)
    if (track && !span) continue
    ids.add(id)
    redactions.push({ id, rect: clipped, time: track && span ? settledBoxTime(span, track.fps, track.durationMs) : null })
  }
  return redactions
}

function cropFrom(value: unknown, bounds: Size | null, isRecording: boolean): Rect | null {
  const rect = rectOf(value)
  if (!rect || !bounds) return null
  if (isRecording) return settleRecordingCrop(rect, bounds)
  const clipped = rectWithin(rect, bounds)
  return clipped && settleSelection(clipped, bounds)
}

interface Source { key: string | null; bounds: Size | null; track: RecordingTrack | null }

function docFrom(value: unknown, { key, bounds, track }: Source): Doc {
  const raw = fieldsOf(value)
  const defaults = DEFAULT_DOC
  const size = fieldsOf(raw.size)
  const requested = {
    width: clampSide(typeof size.width === 'number' ? size.width : NaN, defaults.size.width),
    height: clampSide(typeof size.height === 'number' ? size.height : NaN, defaults.size.height)
  }
  const recording = track ? recordingDocFrom(raw.recording, track) : null
  return {
    sourceId: key,
    size: recording ? evenSize(requested) : requested,
    capturedAt: typeof raw.capturedAt === 'number' ? snapDensity(raw.capturedAt) : defaults.capturedAt,
    zoom: oneOf(UI_ZOOMS, raw.zoom, defaults.zoom),
    crop: cropFrom(raw.crop, bounds, recording !== null),
    edge: isEdge(raw.edge) ? raw.edge : defaults.edge,
    redactions: redactionsFrom(raw.redactions, bounds, track),
    redactStyle: oneOf(REDACT_STYLES, raw.redactStyle, defaults.redactStyle),
    spotlight: spotlightFrom(raw.spotlight, bounds),
    angle: typeof raw.angle === 'number' ? normalizeAngle(raw.angle) : defaults.angle,
    lightColor: typeof raw.lightColor === 'string' && HEX.test(raw.lightColor) ? raw.lightColor : defaults.lightColor,
    lightIntensity: numberIn(raw.lightIntensity, 0, 1, defaults.lightIntensity),
    fill: oneOf(FILLS, raw.fill, defaults.fill),
    fileName: text(raw.fileName, defaults.fileName),
    recording
  }
}

function keyOf(value: unknown): string {
  if (typeof value !== 'string' || !DRAFT_KEY.test(value)) throw new DraftError('damaged')
  return value
}

function shotFrom(value: unknown, tracks: DraftTracks, sizes: Map<string, Size>, kindsByKey: Map<string, string>): DraftShot {
  const raw = fieldsOf(value)
  if (raw.kind === 'empty') return { kind: 'empty', doc: docFrom(raw.doc, { key: null, bounds: null, track: null }) }
  if (raw.kind !== 'screenshot' && raw.kind !== 'recording') throw new DraftError('damaged')
  const key = keyOf(raw.key)
  if ((kindsByKey.get(key) ?? raw.kind) !== raw.kind) throw new DraftError('damaged')
  kindsByKey.set(key, raw.kind)
  if (raw.kind === 'recording') {
    const track = tracks.get(key)
    if (!track) throw new DraftError('damaged')
    const doc = docFrom(raw.doc, { key, bounds: { width: track.width, height: track.height }, track })
    return { kind: 'recording', key, doc, name: text(raw.name, '') }
  }
  const bounds = sizes.get(key)
  if (!bounds) throw new DraftError('damaged')
  const source = fieldsOf(raw.source)
  const doc = docFrom(raw.doc, { key, bounds, track: null })
  return { kind: 'screenshot', key, doc, source: { name: text(source.name, ''), origin: oneOf(ORIGINS, source.origin, 'file'), detected: snapDensity(Number(source.detected)) } }
}

/** A take's track.json as parseTrack reads it, within the bounds a draft allows. */
export function parseDraftTrack(json: string): RecordingTrack {
  let track: RecordingTrack
  try {
    track = parseTrack(JSON.parse(json))
  } catch {
    throw new DraftError('damaged')
  }
  const { durationMs, side, fps } = DRAFT_TRACK_BOUNDS
  if (track.durationMs > durationMs || track.width > side || track.height > side || track.fps > fps) throw new DraftError('damaged')
  return track
}

function manifestFields(manifest: string): Fields {
  let parsed: unknown
  try {
    parsed = JSON.parse(manifest)
  } catch {
    throw new DraftError('not-a-draft')
  }
  const fields = fieldsOf(parsed)
  if (fields.format !== DRAFT_FORMAT || !Number.isInteger(fields.version) || (fields.version as number) < 1) throw new DraftError('not-a-draft')
  if ((fields.version as number) > DRAFT_VERSION) throw new DraftError('newer-version')
  return fields
}

/**
 * Everything is read as sanitizeHouseStyle reads a style: clamped or defaulted, never trusted. `tracks` hold the takes by key, and
 * `sizes` the screenshots' sizes by key, as their PNG headers give them.
 */
export function parseDraftManifest(manifest: string, tracks: DraftTracks, sizes: Map<string, Size> = new Map()): DraftContents {
  try {
    const fields = manifestFields(manifest)
    if (!Array.isArray(fields.shots) || fields.shots.length === 0 || fields.shots.length > DRAFT_LIMITS.shots) throw new DraftError('damaged')
    const kindsByKey = new Map<string, string>()
    const shots = fields.shots.map((shot) => shotFrom(shot, tracks, sizes, kindsByKey))
    const active = Number.isInteger(fields.active) && (fields.active as number) >= 0 && (fields.active as number) < shots.length ? (fields.active as number) : 0
    const style = typeof fields.style === 'object' && fields.style !== null ? loadHouseStyle(fields.style) : DEFAULT_HOUSE_STYLE
    return { style, active, shots }
  } catch (error) {
    throw error instanceof DraftError ? error : new DraftError('damaged')
  }
}

type KeyKind = 'image' | 'take'

function keyFor(keysByKind: Record<KeyKind, Map<string, string>>, kind: KeyKind, sourceId: string): string {
  const keys = keysByKind[kind]
  const existing = keys.get(sourceId)
  if (existing) return existing
  const key = `${kind}${keys.size + 1}`
  keys.set(sourceId, key)
  return key
}

function shotEntry(record: ShotRecord, keys: Record<KeyKind, Map<string, string>>, nameOf: (record: ShotRecord) => string): object {
  const { doc } = record
  if (doc.sourceId === null) return { kind: 'empty', doc }
  if (doc.recording) {
    const key = keyFor(keys, 'take', doc.sourceId)
    return { kind: 'recording', key, name: nameOf(record), doc: { ...doc, sourceId: key } }
  }
  const key = keyFor(keys, 'image', doc.sourceId)
  const source = getSource(doc.sourceId)
  return {
    kind: 'screenshot',
    key,
    source: { name: source?.name ?? nameOf(record), origin: source?.origin ?? 'file', detected: source?.detected ?? doc.capturedAt },
    doc: { ...doc, sourceId: key }
  }
}

/**
 * The keys name each source or take once, whichever shots show it. They become the file names of Task 22's archive. They're
 * kept per kind, source id → key for screenshots and take id → key for recordings, since a source and a take could share an id.
 */
export function buildDraftManifest(
  shots: ShotRecord[],
  activeId: string,
  style: HouseStyle,
  appVersion: string,
  nameOf: (record: ShotRecord) => string
): { manifest: string; keys: Record<KeyKind, Map<string, string>> } {
  const keys: Record<KeyKind, Map<string, string>> = { image: new Map(), take: new Map() }
  const entries = shots.map((record) => shotEntry(record, keys, nameOf))
  const manifest = JSON.stringify({
    format: DRAFT_FORMAT,
    version: DRAFT_VERSION,
    savedBy: appVersion,
    style: serializeHouseStyle(style),
    active: Math.max(0, shots.findIndex((record) => record.id === activeId)),
    shots: entries
  })
  return { manifest, keys }
}
