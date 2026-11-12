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
import { getSource, type ShotRecord, type SourceEntry } from '../app/store'
import { clamp, clipTo, type Rect, type Size } from '../render/geometry'
import { settledBoxTime } from '../recording/blur-boxes'
import { settleRecordingCrop } from '../recording/crop'
import type { CursorLook } from '../recording/cursor-art'
import type { ClickEffect } from '../recording/effects'
import type { ZoomSpeed } from '../recording/camera'
import { normalizePieces } from '../recording/pieces'
import { DEFAULT_RECORDING, type RecordingDoc, type RecordingFps } from '../recording/settings'
import { clampTrim, type Trim } from '../recording/trim'
import type { RecordingTrack } from '../recording/track'
import { normalizeZoomEdits } from '../recording/zoom-edits'

export const DRAFT_FORMAT = 'cawmera-draft'
export const DRAFT_VERSION = 1

export type DraftFailure = 'not-a-draft' | 'newer-version' | 'damaged'

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

const ORIGINS: SourceEntry['origin'][] = ['paste', 'drop', 'file', 'capture']
const REDACT_STYLES: RedactStyle[] = ['blur', 'pixelate', 'solid']
const FILLS: Fill[] = ['gradient', 'image']
const LOOKS: CursorLook[] = ['light', 'dark']
const CLICK_EFFECTS: ClickEffect[] = ['off', 'ring', 'ripple']
const ZOOM_SPEEDS: ZoomSpeed[] = ['calm', 'quick']
const FPS_CHOICES: RecordingFps[] = [30, 60]
const CURSOR_SIZE_RANGE = { min: 0.5, max: 3 }
const MAX_NAME_LENGTH = 200
const KEY = /^[A-Za-z0-9_-]{1,64}$/
const HEX = /^#[0-9a-f]{6}$/i

type Fields = Record<string, unknown>

const fieldsOf = (value: unknown): Fields => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : {})
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const oneOf = <T>(choices: readonly T[], value: unknown, fallback: T): T => (choices.includes(value as T) ? (value as T) : fallback)
const boolean = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)
const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value.slice(0, MAX_NAME_LENGTH) : fallback)
const numberIn = (value: unknown, min: number, max: number, fallback: number) => (isFiniteNumber(value) ? clamp(value, min, max) : fallback)

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
  const trim = trimOf(raw.trim, track.durationMs)
  const defaults = DEFAULT_RECORDING
  return {
    trim,
    pieces: normalizePieces(raw.pieces, track.durationMs),
    zooms: normalizeZoomEdits(raw.zooms, trim)?.map((edit) => ({ ...edit, focus: { x: clamp(edit.focus.x, 0, track.width), y: clamp(edit.focus.y, 0, track.height) } })) ?? null,
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

function redactionsFrom(value: unknown, bounds: Size | null, recording: { doc: RecordingDoc; track: RecordingTrack } | null): Redaction[] {
  if (!bounds || !Array.isArray(value)) return []
  const ids = new Set<string>()
  const redactions: Redaction[] = []
  for (const entry of value) {
    const { id, rect, time } = fieldsOf(entry)
    const clipped = rectWithin(rect, bounds)
    if (typeof id !== 'string' || id === '' || ids.has(id) || !clipped) continue
    const span = spanOf(time)
    if (recording && !span) continue
    ids.add(id)
    redactions.push({
      id,
      rect: clipped,
      time: recording && span ? settledBoxTime(span, recording.doc.trim, recording.track.fps, recording.track.durationMs) : null
    })
  }
  return redactions
}

function cropFrom(value: unknown, bounds: Size | null, isRecording: boolean): Rect | null {
  const rect = rectOf(value)
  if (!rect || !bounds) return null
  return isRecording ? settleRecordingCrop(rect, bounds) : rectWithin(rect, bounds)
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
    redactions: redactionsFrom(raw.redactions, bounds, track && recording ? { doc: recording, track } : null),
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
  if (typeof value !== 'string' || !KEY.test(value)) throw new DraftError('damaged')
  return value
}

function shotFrom(value: unknown, tracks: Map<string, RecordingTrack>, sizes: Map<string, Size>, kindsByKey: Map<string, string>): DraftShot {
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

/** Everything is read as sanitizeHouseStyle reads a style: clamped or defaulted, never trusted. `tracks` hold the takes by key and `sizes` the decoded screenshots by key. */
export function parseDraftManifest(manifest: string, tracks: Map<string, RecordingTrack>, sizes: Map<string, Size> = new Map()): DraftContents {
  try {
    const fields = manifestFields(manifest)
    if (!Array.isArray(fields.shots) || fields.shots.length === 0) throw new DraftError('damaged')
    const kindsByKey = new Map<string, string>()
    const shots = fields.shots.map((shot) => shotFrom(shot, tracks, sizes, kindsByKey))
    const active = Number.isInteger(fields.active) && (fields.active as number) >= 0 && (fields.active as number) < shots.length ? (fields.active as number) : 0
    const style = typeof fields.style === 'object' && fields.style !== null ? loadHouseStyle(fields.style) : DEFAULT_HOUSE_STYLE
    return { style, active, shots }
  } catch (error) {
    throw error instanceof DraftError ? error : new DraftError('damaged')
  }
}

function keyFor(keys: Map<string, string>, sourceId: string, prefix: string): string {
  const existing = keys.get(sourceId)
  if (existing) return existing
  const key = `${prefix}-${[...keys.values()].filter((other) => other.startsWith(`${prefix}-`)).length + 1}`
  keys.set(sourceId, key)
  return key
}

function shotEntry(record: ShotRecord, keys: Map<string, string>, nameOf: (record: ShotRecord) => string): object {
  const { doc } = record
  if (doc.sourceId === null) return { kind: 'empty', doc }
  if (doc.recording) {
    const key = keyFor(keys, doc.sourceId, 'take')
    return { kind: 'recording', key, name: nameOf(record), doc: { ...doc, sourceId: key } }
  }
  const key = keyFor(keys, doc.sourceId, 'image')
  const source = getSource(doc.sourceId)
  return {
    kind: 'screenshot',
    key,
    source: { name: source?.name ?? nameOf(record), origin: source?.origin ?? 'file', detected: source?.detected ?? doc.capturedAt },
    doc: { ...doc, sourceId: key }
  }
}

/** The keys name each source or take once, whichever shots show it. They become the file names of Task 22's archive. */
export function buildDraftManifest(
  shots: ShotRecord[],
  activeId: string,
  style: HouseStyle,
  appVersion: string,
  nameOf: (record: ShotRecord) => string
): { manifest: string; keys: Map<string, string> } {
  const keys = new Map<string, string>()
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
