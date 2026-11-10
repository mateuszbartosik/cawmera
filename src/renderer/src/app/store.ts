import { useSyncExternalStore } from 'react'
import { decodeBackdrop } from './backdrop'
import { DEFAULT_DOC, randomAngle, type Density, type Doc, type ExportFormat } from './doc'
import { DEFAULT_HOUSE_STYLE, loadHouseStyle, serializeHouseStyle, type HouseStyle } from './house-style'
import type { TimelineView } from '../timeline/scale'

export type Mode = 'compose' | 'crop'
/** A blur box or the spotlight of the active shot. */
export type BoxRef = { kind: 'redaction'; id: string } | { kind: 'spotlight' }
/** The selected boxes of the active shot, in the order they were selected (empty: none). */
export type Selection = BoxRef[]
export const boxKey = (box: BoxRef) => (box.kind === 'redaction' ? box.id : 'spotlight')
export const hasBox = (selection: Selection, box: BoxRef) => selection.some((candidate) => boxKey(candidate) === boxKey(box))
/** What the recording timeline has selected: a stretch of the take, or a zoom (source ms). */
export type TimelineSelection = { kind: 'range'; start: number; end: number } | { kind: 'zoom'; id: string } | null
export type Theme = 'dark' | 'light'
export type CaptureDelay = 0 | 3 | 5 | 10
export type CaptureMode = 'screenshot' | 'recording'

/** Playback of the active recording shot: the playhead is in source time (ms). */
export interface Playback {
  playing: boolean
  time: number
}

/** One camera per canvas: the shots canvas and the crop view keep their own. */
export interface Camera {
  /** Follow the content (all shots, or the active one), or stay where the user put it. */
  fit: 'all' | 'active' | null
  zoom: number
  /** World point at the centre of the area: export px on the shots canvas, source px while cropping. */
  cx: number
  cy: number
}

export const FIT_ALL: Camera = { fit: 'all', zoom: 1, cx: 0, cy: 0 }

export interface CaptureState {
  phase: 'idle' | 'picking' | 'countdown' | 'grabbing' | 'recording'
  remaining: number
}

export interface SourceEntry {
  id: string
  bitmap: ImageBitmap
  width: number
  height: number
  name: string
  origin: 'paste' | 'drop' | 'file' | 'capture'
  detected: Density
}

/** One image being prepared. Each keeps its own undo history. */
export interface ShotRecord {
  id: string
  doc: Doc
  past: Doc[]
  future: Doc[]
  /** The document as it was last written to a file; anything else is unsaved work. */
  savedDoc: Doc | null
}

export interface AppState {
  /** The active shot, live. Its entry in `shots` is refreshed whenever another shot is selected. */
  activeId: string
  doc: Doc
  past: Doc[]
  future: Doc[]
  savedDoc: Doc | null
  shots: ShotRecord[]
  mode: Mode
  selection: Selection
  /** The part of the take the timeline rows show; null is the whole take. */
  timelineView: TimelineView | null
  /** Exclusive with `selection`: setting one clears the other. */
  timelineSelection: TimelineSelection
  /**
   * Shots picked on the canvas (Shift/Ctrl-click, a drag on empty canvas, Ctrl+A), for acting on
   * several at once. Empty when nothing is picked; otherwise it includes the active shot.
   */
  shotSelection: string[]
  theme: Theme
  collapsed: Record<string, boolean>
  delay: CaptureDelay
  format: ExportFormat
  capture: CaptureState
  captureMode: CaptureMode
  playback: Playback
  /** Share of the video export done (0..1); null when no export runs. */
  exportProgress: number | null
  houseStyleOpen: boolean
  style: HouseStyle
  /** The house background image, decoded; null when the style has none, or while it decodes. */
  backdrop: { url: string; bitmap: ImageBitmap } | null
  /** Camera of the shots canvas. */
  view: Camera
  /** Camera of the crop view (the active shot's whole screenshot). */
  cropView: Camera
  viewport: { width: number; height: number }
  dragOver: boolean
}

// ---------------------------------------------------------------------------
// Persistence: per-viewer conveniences only. Screenshots are never stored.

const PREFS_KEY = 'cawmera.prefs.v1'
const STYLE_KEY = 'cawmera.houseStyle.v1'
/** The house background image is megabytes, so it's stored on its own and only written when it changes. */
const STYLE_IMAGE_KEY = 'cawmera.houseStyleImage.v1'

interface Prefs {
  theme: Theme
  delay: CaptureDelay
  format: ExportFormat
  collapsed: Record<string, boolean>
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage can be unavailable; the app works without it */
  }
}

function readText(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeText(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* too big or unavailable: the image still works until Cawmera closes */
  }
}

function loadStoredStyle(): HouseStyle {
  const stored = readJson(STYLE_KEY)
  if (!stored || typeof stored !== 'object') return DEFAULT_HOUSE_STYLE
  return loadHouseStyle({ ...stored, backgroundImage: readText(STYLE_IMAGE_KEY) })
}

function loadPrefs(): Prefs {
  const raw = (readJson(PREFS_KEY) ?? {}) as Partial<Prefs>
  return {
    theme: raw.theme === 'light' ? 'light' : 'dark',
    delay: ([0, 3, 5, 10] as const).includes(raw.delay as CaptureDelay) ? (raw.delay as CaptureDelay) : 0,
    format: raw.format === 'png' ? 'png' : 'webp',
    collapsed: raw.collapsed && typeof raw.collapsed === 'object' ? raw.collapsed : {}
  }
}

export const newId = () => Math.random().toString(36).slice(2, 10)

/** A new shot: a light direction unlike its neighbour's; the same size, background, light colour and intensity. */
export function emptyDoc(previous?: Doc): Doc {
  return {
    ...DEFAULT_DOC,
    size: previous?.size ?? DEFAULT_DOC.size,
    fill: previous?.fill ?? DEFAULT_DOC.fill,
    angle: randomAngle(previous?.angle),
    lightColor: previous?.lightColor ?? null,
    lightIntensity: previous?.lightIntensity ?? DEFAULT_DOC.lightIntensity
  }
}

const prefs = loadPrefs()
const firstShot: ShotRecord = { id: newId(), doc: emptyDoc(), past: [], future: [], savedDoc: null }

let state: AppState = {
  activeId: firstShot.id,
  doc: firstShot.doc,
  past: [],
  future: [],
  savedDoc: null,
  shots: [firstShot],
  mode: 'compose',
  selection: [],
  timelineView: null,
  timelineSelection: null,
  shotSelection: [],
  theme: prefs.theme,
  collapsed: prefs.collapsed,
  delay: prefs.delay,
  format: prefs.format,
  capture: { phase: 'idle', remaining: 0 },
  captureMode: 'screenshot',
  playback: { playing: false, time: 0 },
  exportProgress: null,
  houseStyleOpen: false,
  style: loadStoredStyle(),
  backdrop: null,
  view: FIT_ALL,
  cropView: FIT_ALL,
  viewport: { width: 0, height: 0 },
  dragOver: false
}

const listeners = new Set<() => void>()

let backdropDecoding: Promise<void> = Promise.resolve()

/** Decodes the house background image whenever the style gets a different one. */
function syncBackdrop() {
  const url = state.style.backgroundImage
  if ((state.backdrop?.url ?? null) === url) return
  state.backdrop?.bitmap.close()
  state = { ...state, backdrop: null }
  if (!url) return
  backdropDecoding = decodeBackdrop(url).then(
    (bitmap) => {
      if (state.style.backgroundImage === url) store.set({ backdrop: { url, bitmap } })
      else bitmap.close()
    },
    () => {
      /* not decodable: shots set to Image keep the gradient */
    }
  )
}

/** Resolves once the house background image, if any, can be drawn (before an export). */
export const backdropReady = () => backdropDecoding

/** Selecting boxes drops the timeline selection and the other way round. */
function keepSelectionsExclusive(prev: AppState, patch: Partial<AppState>): Partial<AppState> {
  const boxesChosen = patch.selection !== undefined && patch.selection.length > 0 && patch.selection !== prev.selection
  const timelineChosen = patch.timelineSelection != null && patch.timelineSelection !== prev.timelineSelection
  if (boxesChosen && timelineChosen) return { ...patch, selection: [] }
  if (boxesChosen && prev.timelineSelection !== null) return { ...patch, timelineSelection: null }
  if (timelineChosen && prev.selection.length > 0) return { ...patch, selection: [] }
  return patch
}

export const store = {
  get: () => state,
  set(patch: Partial<AppState> | ((current: AppState) => Partial<AppState>)) {
    const requested = typeof patch === 'function' ? patch(state) : patch
    const prev = state
    const next = keepSelectionsExclusive(prev, requested)
    state = { ...state, ...next }
    if (prev.style.backgroundImage !== state.style.backgroundImage) syncBackdrop()
    if (
      prev.theme !== state.theme ||
      prev.delay !== state.delay ||
      prev.format !== state.format ||
      prev.collapsed !== state.collapsed
    ) {
      writeJson(PREFS_KEY, { theme: state.theme, delay: state.delay, format: state.format, collapsed: state.collapsed })
    }
    if (prev.style !== state.style) writeJson(STYLE_KEY, serializeHouseStyle({ ...state.style, backgroundImage: null }))
    if (prev.style.backgroundImage !== state.style.backgroundImage) writeText(STYLE_IMAGE_KEY, state.style.backgroundImage)
    listeners.forEach((listener) => listener())
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
}

syncBackdrop()

export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state))
}

// ---------------------------------------------------------------------------
// Shots

/** All shots with the active one's live document. */
export function liveShots(s: AppState = state): ShotRecord[] {
  return s.shots.map((record) =>
    record.id === s.activeId ? { ...record, doc: s.doc, past: s.past, future: s.future, savedDoc: s.savedDoc } : record
  )
}

/** Memoized for React: the same array until a shot or the active document changes. */
let liveCache: { shots: ShotRecord[]; doc: Doc; savedDoc: Doc | null; result: ShotRecord[] } | null = null
export function selectLiveShots(s: AppState): ShotRecord[] {
  if (liveCache && liveCache.shots === s.shots && liveCache.doc === s.doc && liveCache.savedDoc === s.savedDoc) {
    return liveCache.result
  }
  const result = liveShots(s)
  liveCache = { shots: s.shots, doc: s.doc, savedDoc: s.savedDoc, result }
  return result
}

export const isUnsaved = (record: ShotRecord) => record.doc.sourceId !== null && record.doc !== record.savedDoc

function activate(shots: ShotRecord[], id: string): Partial<AppState> {
  const target = shots.find((record) => record.id === id) ?? shots[0]
  return {
    shots,
    activeId: target.id,
    doc: target.doc,
    past: target.past,
    future: target.future,
    savedDoc: target.savedDoc,
    mode: 'compose',
    selection: [],
    timelineView: null,
    timelineSelection: null,
    shotSelection: []
  }
}

/** Makes a shot active (a plain click): any multi-selection of shots goes. */
export function selectShot(id: string) {
  if (id === state.activeId) {
    if (state.shotSelection.length > 0) store.set({ shotSelection: [] })
    return
  }
  store.set((s) => activate(liveShots(s), id))
}

/** Sets the picked shots. The active shot stays if it's among them; otherwise the first one becomes active. */
function pickShots(selected: string[]) {
  const s = state
  const known = new Set(s.shots.map((record) => record.id))
  const ids = [...new Set(selected)].filter((id) => known.has(id))
  if (ids.length === 0) {
    store.set({ shotSelection: [] })
    return
  }
  const activeId = ids.includes(s.activeId) ? s.activeId : ids[0]
  store.set((current) => ({
    ...(activeId === current.activeId ? { selection: [] } : activate(liveShots(current), activeId)),
    shotSelection: ids
  }))
}

/**
 * Shift/Ctrl-click on a shot: adds it to the picked shots (with the active one, when nothing was
 * picked yet), or takes it out. A shot added becomes active, so the panel shows what was clicked.
 */
export function toggleShotPicked(id: string) {
  const s = state
  const base = s.shotSelection.length > 0 ? s.shotSelection : id === s.activeId ? [] : [s.activeId]
  if (base.includes(id)) {
    const rest = base.filter((candidate) => candidate !== id)
    // Taking out the active shot hands the panel to the shot picked last.
    pickShots(rest.includes(s.activeId) ? rest : [...rest.slice(-1), ...rest.slice(0, -1)])
    return
  }
  const next = [...base, id]
  store.set((current) => ({ ...activate(liveShots(current), id), shotSelection: next }))
}

/** Picks the shots a drag on the empty canvas touched; with Shift/Ctrl it adds to the ones picked. */
export function pickShotsInArea(ids: string[], additive: boolean) {
  const s = state
  const base = additive ? (s.shotSelection.length > 0 ? s.shotSelection : [s.activeId]) : []
  pickShots([...base, ...ids])
}

export function pickAllShots() {
  pickShots(state.shots.map((record) => record.id))
}

export function clearPickedShots() {
  if (state.shotSelection.length > 0) store.set({ shotSelection: [] })
}

/** Adds a shot at the end of the row and makes it active. */
export function addShot(doc?: Doc): string {
  const id = newId()
  store.set((s) => {
    const shots = liveShots(s)
    const last = shots.at(-1)?.doc
    const record: ShotRecord = { id, doc: doc ?? emptyDoc(last), past: [], future: [], savedDoc: null }
    return activate([...shots, record], id)
  })
  return id
}

/** What `removeShots` took out, enough to put it all back. */
export interface RemovedShots {
  removed: { record: ShotRecord; index: number }[]
  /** The empty shot that replaced them when no shot was left. */
  placeholder: string | null
}

/** Removes shots; returns what's needed to put them back. When none is left, an empty one takes over. */
export function removeShots(ids: string[]): RemovedShots | null {
  const shots = liveShots()
  const removed = shots.flatMap((record, index) => (ids.includes(record.id) ? [{ record, index }] : []))
  if (removed.length === 0) return null
  let rest = shots.filter((record) => !ids.includes(record.id))
  let placeholder: string | null = null
  if (rest.length === 0) {
    placeholder = newId()
    rest = [{ id: placeholder, doc: emptyDoc(removed.at(-1)!.record.doc), past: [], future: [], savedDoc: null }]
  }
  const nextActive = ids.includes(state.activeId) ? rest[Math.min(removed[0].index, rest.length - 1)].id : state.activeId
  store.set(() => activate(rest, nextActive))
  return { removed, placeholder }
}

/** Undo for `removeShots`: every shot back in its place, picked again when there were several. */
export function restoreShots({ removed, placeholder }: RemovedShots) {
  store.set((s) => {
    const back = new Set(removed.map(({ record }) => record.id))
    let shots = liveShots(s).filter((candidate) => !back.has(candidate.id))
    // Drop the placeholder that replaced them, if it's still untouched.
    shots = shots.filter((candidate) => !(candidate.id === placeholder && candidate.doc.sourceId === null && candidate.past.length === 0))
    for (const { record, index } of [...removed].sort((a, b) => a.index - b.index)) {
      shots.splice(Math.min(index, shots.length), 0, record)
    }
    return { ...activate(shots, removed[0].record.id), shotSelection: removed.length > 1 ? [...back] : [] }
  })
}

export function moveShot(id: string, toIndex: number) {
  store.set((s) => {
    const shots = liveShots(s)
    const from = shots.findIndex((record) => record.id === id)
    if (from < 0) return {}
    const [record] = shots.splice(from, 1)
    shots.splice(Math.max(0, Math.min(toIndex, shots.length)), 0, record)
    return { shots }
  })
}

export function markSaved(ids: string[]) {
  store.set((s) => ({
    savedDoc: ids.includes(s.activeId) ? s.doc : s.savedDoc,
    shots: s.shots.map((record) => (ids.includes(record.id) && record.id !== s.activeId ? { ...record, savedDoc: record.doc } : record))
  }))
}

/** Marks `doc`, the state that was written to a file, as saved: edits made since still count as unsaved. */
export function markSnapshotSaved(id: string, doc: Doc) {
  store.set((s) => ({
    savedDoc: id === s.activeId ? doc : s.savedDoc,
    shots: s.shots.map((record) => (record.id === id && record.id !== s.activeId ? { ...record, savedDoc: doc } : record))
  }))
}

// ---------------------------------------------------------------------------
// Sources live outside the state: big bitmaps, referenced by id from documents and history.

const sources = new Map<string, SourceEntry>()
const MAX_SOURCES = 24

export function getSource(id: string | null): SourceEntry | null {
  return id ? (sources.get(id) ?? null) : null
}

export function registerSource(entry: SourceEntry) {
  sources.set(entry.id, entry)
  if (sources.size <= MAX_SOURCES) return
  // Drop the oldest bitmaps no shot is showing, and the history steps that still point at them.
  const inUse = new Set(liveShots().map((record) => record.doc.sourceId))
  for (const id of [...sources.keys()]) {
    if (sources.size <= MAX_SOURCES) break
    if (id === entry.id || inUse.has(id)) continue
    sources.get(id)?.bitmap.close()
    sources.delete(id)
  }
  const alive = (doc: Doc) => doc.sourceId === null || doc.recording !== null || sources.has(doc.sourceId)
  store.set((s) => ({
    past: s.past.filter(alive),
    future: s.future.filter(alive),
    shots: s.shots.map((record) => ({ ...record, past: record.past.filter(alive), future: record.future.filter(alive) }))
  }))
}

// ---------------------------------------------------------------------------
// Document + history (of the active shot)

const HISTORY_LIMIT = 100

/** The selected boxes that still exist in `doc` (the same array when nothing went). */
function validSelection(doc: Doc, selection: Selection): Selection {
  const kept = selection.filter((box) => (box.kind === 'spotlight' ? doc.spotlight.on : doc.redactions.some((r) => r.id === box.id)))
  return kept.length === selection.length ? selection : kept
}

const zoomEditIds = (_doc: Doc): string[] => []

const takeDuration = (doc: Doc) => doc.recording?.pieces.at(-1)?.end ?? 0

/** The timeline selection as `doc` still allows it: a gone zoom clears it, a range is clamped to the take (cleared when nothing is left). */
export function validTimelineSelection(doc: Doc, selection: TimelineSelection): TimelineSelection {
  if (!selection) return null
  if (selection.kind === 'zoom') return zoomEditIds(doc).includes(selection.id) ? selection : null
  const start = Math.max(selection.start, 0)
  const end = Math.min(selection.end, takeDuration(doc))
  if (end <= start) return null
  return start === selection.start && end === selection.end ? selection : { kind: 'range', start, end }
}

/** Changes the active document. `history: false` is for continuous drags; call `commitFrom` when they end. */
export function updateDoc(patch: Partial<Doc> | ((doc: Doc) => Partial<Doc>), options: { history?: boolean } = {}) {
  const current = state.doc
  const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) }
  const history = options.history ?? true
  store.set((s) => ({
    doc: next,
    past: history ? [...s.past, current].slice(-HISTORY_LIMIT) : s.past,
    future: history ? [] : s.future,
    selection: validSelection(next, s.selection),
    timelineSelection: validTimelineSelection(next, s.timelineSelection)
  }))
}

/** Records one undo step for a drag that started at `before`. */
export function commitFrom(before: Doc) {
  if (before === state.doc) return
  store.set((s) => ({ past: [...s.past, before].slice(-HISTORY_LIMIT), future: [] }))
}

export function undo() {
  const { past, doc, future } = state
  const previous = past.at(-1)
  if (!previous) return
  store.set((s) => ({
    doc: previous,
    past: past.slice(0, -1),
    future: [doc, ...future].slice(0, HISTORY_LIMIT),
    selection: validSelection(previous, s.selection),
    timelineSelection: validTimelineSelection(previous, s.timelineSelection),
    mode: previous.sourceId ? s.mode : 'compose'
  }))
}

export function redo() {
  const { past, doc, future } = state
  const next = future[0]
  if (!next) return
  store.set((s) => ({
    doc: next,
    past: [...past, doc].slice(-HISTORY_LIMIT),
    future: future.slice(1),
    selection: validSelection(next, s.selection),
    timelineSelection: validTimelineSelection(next, s.timelineSelection),
    mode: next.sourceId ? s.mode : 'compose'
  }))
}
