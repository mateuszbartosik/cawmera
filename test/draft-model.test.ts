import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_DOC, type Doc, type Redaction } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE, type HouseStyle } from '../src/renderer/src/app/house-style'
import type { ShotRecord } from '../src/renderer/src/app/store'
import { DRAFT_KEY } from '@shared/draft-key'
import {
  buildDraftManifest,
  DRAFT_FORMAT,
  DRAFT_LIMITS,
  DRAFT_SHOWN_TRACKS_BYTES,
  DRAFT_TRACK_BOUNDS,
  DRAFT_VERSION,
  DraftError,
  fitsDraftTrackBounds,
  fitsShownTracksBudget,
  parseDraftManifest,
  parseDraftTrack,
  utf8Bytes,
  type DraftTracks
} from '../src/renderer/src/drafts/model'
import { snapDownToFrame } from '../src/renderer/src/recording/blur-boxes'
import { normalizePieces } from '../src/renderer/src/recording/pieces'
import { CURSOR_SIZE_RANGE, DEFAULT_RECORDING, type RecordingDoc } from '../src/renderer/src/recording/settings'
import { wholeTake, type Piece } from '../src/renderer/src/recording/timemap'
import { parseTrack, serializeTrack, type RecordingTrack } from '../src/renderer/src/recording/track'
import { ZOOM_DEPTH_RANGE, normalizeZoomEdits, type ZoomEdit } from '../src/renderer/src/recording/zoom-edits'
import { ZOOM_RULES } from '../src/renderer/src/recording/zooms'

const track: RecordingTrack = {
  kind: 'monitor',
  width: 1920,
  height: 1080,
  fps: 60,
  durationMs: 10_000,
  scale: 1,
  cursor: [
    { t: 0, x: 10, y: 20, shape: 'arrow' },
    { t: 16, x: 30, y: 40, shape: 'hand' },
    { t: 32, x: 50, y: 60, shape: null },
    { t: 48, x: 70, y: 80, shape: 'other' }
  ],
  clicks: [
    { t: 100, x: 30, y: 40, button: 'left', up: 190 },
    { t: 500, x: 70, y: 80, button: 'right', up: null }
  ]
}
const style: HouseStyle = { ...DEFAULT_HOUSE_STYLE, name: 'Mine', plateFrom: '#112233' }
const piece = (start: number, end: number, rate: Piece['rate'] = 1, cut = false): Piece => ({ start, end, rate, cut })
const zoom = (id: string, start: number, end: number, extra: Partial<ZoomEdit> = {}): ZoomEdit => ({ id, start, end, depth: 2, aim: 'manual', focus: { x: 100, y: 100 }, ...extra })

const editedRecording: RecordingDoc = {
  ...DEFAULT_RECORDING,
  cursorSize: 2,
  look: 'dark',
  trim: { start: 500, end: 9000 },
  pieces: [piece(0, 4000), piece(4000, 6000, 4, true), piece(6000, 10_000, 2)],
  zooms: [zoom('z1', 1000, 2000), zoom('z2', 3000, 3800, { aim: 'auto' })]
}
const blurBox: Redaction = { id: 'r1', rect: { x: 10, y: 20, w: 300, h: 100 }, time: { start: 600, end: 2000 } }
const shotBox: Redaction = { id: 'r2', rect: { x: 5, y: 5, w: 50, h: 50 }, time: null }

const record = (id: string, doc: Doc, defaultName = 'calm-owl-date'): ShotRecord => ({ id, defaultName, doc, past: [], future: [], savedDoc: null, draftDoc: null })
const shots: ShotRecord[] = [
  record('s0', { ...DEFAULT_DOC, angle: 100 }, 'brave-otter-fig'),
  record('s1', { ...DEFAULT_DOC, sourceId: 'img1', capturedAt: 2, angle: 200, redactions: [shotBox], crop: { x: 0, y: 0, w: 400, h: 300 }, fileName: 'billing' }, 'calm-owl-date'),
  record('s2', { ...DEFAULT_DOC, sourceId: 'take1', size: { width: 1920, height: 1080 }, redactions: [blurBox], crop: { x: 100, y: 50, w: 800, h: 600 }, recording: editedRecording }, 'quick-fox-lime')
]
const imageSize = { width: 800, height: 600 }

const failure = (text: string) => {
  try {
    parseDraftManifest(text, new Map())
    return null
  } catch (error) {
    return error instanceof DraftError ? error.reason : `other: ${String(error)}`
  }
}

const recordingOnly = () => buildDraftManifest([shots[2]], 's2', style, '0.8.0', (r) => r.id)

function manifestWith(doc: Record<string, unknown>): string {
  const parsed = JSON.parse(recordingOnly().manifest)
  parsed.shots[0] = { ...parsed.shots[0], doc: { ...parsed.shots[0].doc, ...doc } }
  return JSON.stringify(parsed)
}

const parsedRecording = (doc: Record<string, unknown>) => {
  const key = recordingOnly().keys.take.get('take1')!
  return parseDraftManifest(manifestWith(doc), new Map([[key, track]])).shots[0].doc
}

describe('serializeTrack', () => {
  it('round-trips a track', () => expect(parseTrack(JSON.parse(serializeTrack(track)))).toEqual(track))
  it('writes track.json version 1', () => expect(JSON.parse(serializeTrack(track))).toMatchObject({ version: 1, kind: 'monitor', durationMs: 10_000 }))
})

describe('a draft’s track', () => {
  const trackJson = (changes: Partial<RecordingTrack>) => serializeTrack({ ...track, ...changes })
  const reasonOf = (json: string) => {
    try {
      parseDraftTrack(json)
      return null
    } catch (error) {
      return error instanceof DraftError ? error.reason : `other: ${String(error)}`
    }
  }

  it('reads a take’s track.json', () => expect(parseDraftTrack(serializeTrack(track))).toEqual(track))

  it('calls a track that isn’t one damaged', () => {
    for (const bad of ['', '{', '[]', '{"version":1}', trackJson({ fps: 0 }), trackJson({ width: 12.5 })]) expect(reasonOf(bad)).toBe('damaged')
  })

  it('takes a track right at each bound and calls one past a bound damaged', () => {
    const { durationMs, side, fps } = DRAFT_TRACK_BOUNDS
    expect([durationMs, side, fps]).toEqual([4 * 60 * 60 * 1000, 16_384, 240])
    for (const atBound of [{ durationMs }, { width: side }, { height: side }, { fps }]) expect(reasonOf(trackJson(atBound))).toBeNull()
    for (const pastBound of [{ durationMs: durationMs + 1 }, { durationMs: 1e11 }, { width: side + 1 }, { height: side + 1 }, { fps: fps + 1 }]) {
      expect(reasonOf(trackJson(pastBound))).toBe('damaged')
    }
  })

  it('shares its bounds with the check made before saving', () => {
    const { durationMs, side, fps } = DRAFT_TRACK_BOUNDS
    expect(fitsDraftTrackBounds({ ...track, durationMs, width: side, height: side, fps })).toBe(true)
    for (const pastBound of [{ durationMs: durationMs + 1 }, { width: side + 1 }, { height: side + 1 }, { fps: fps + 1 }]) {
      expect(fitsDraftTrackBounds({ ...track, ...pastBound })).toBe(false)
    }
  })
})

describe('the tracks a draft’s shots show', () => {
  const spaces = (count: number) => ' '.repeat(count)

  it('are counted in UTF-8 bytes, as main reads them', () => {
    expect([utf8Bytes(''), utf8Bytes('{"version":1}'), utf8Bytes('é'), utf8Bytes('€'), utf8Bytes('😀')]).toEqual([0, 13, 2, 3, 4])
    for (const text of ['zażółć gęślą jaźń', '€ 😀 x', serializeTrack(track)]) expect(utf8Bytes(text)).toBe(new TextEncoder().encode(text).length)
  })

  it('may add up to 64 MB together, and no more', () => {
    expect(DRAFT_SHOWN_TRACKS_BYTES).toBe(64_000_000)
    expect(fitsShownTracksBudget([])).toBe(true)
    expect(fitsShownTracksBudget([spaces(32_000_000), spaces(32_000_000)])).toBe(true)
    expect(fitsShownTracksBudget([spaces(32_000_000), spaces(31_999_999), spaces(2)])).toBe(false)
    expect(fitsShownTracksBudget([spaces(63_999_999), 'é'])).toBe(false)
  })

  it('are named to the tracks before any is read, once each, and only the takes recording shots show', () => {
    const calls: string[] = []
    const tracks: DraftTracks = {
      checkShown: (keys) => void calls.push(`shown ${[...keys].join(' ')}`),
      get: (key) => {
        calls.push(`read ${key}`)
        return track
      }
    }
    const shotsInput = [
      { kind: 'recording', key: 'take1', doc: {} },
      { kind: 'empty', doc: {} },
      { kind: 'recording', key: 'take2', doc: {} },
      { kind: 'recording', key: 'take1', doc: {} }
    ]
    parseDraftManifest(JSON.stringify({ format: DRAFT_FORMAT, version: 1, shots: shotsInput }), tracks)
    expect(calls).toEqual(['shown take1 take2', 'read take1', 'read take2', 'read take1'])
  })

  it('stop the draft before any track is read when the tracks refuse them', () => {
    const get = vi.fn(() => track)
    const refuse = () => {
      throw new DraftError('too-large')
    }
    const text = JSON.stringify({ format: DRAFT_FORMAT, version: 1, shots: [{ kind: 'recording', key: 'take1', doc: {} }] })
    expect(() => parseDraftManifest(text, { checkShown: refuse, get })).toThrow(DraftError)
    expect(get).not.toHaveBeenCalled()
  })
})

describe('normalizePieces', () => {
  it('falls back to the whole take for anything invalid', () => {
    for (const bad of [undefined, null, 'x', 4, {}, [], [{ start: 'a', end: 2 }]]) expect(normalizePieces(bad, 5000)).toEqual(wholeTake(5000))
  })
  it('tiles the take from valid pieces', () => expect(normalizePieces([piece(0, 2000, 2), piece(2500, 9000, 1, true)], 5000)).toEqual([piece(0, 2500, 2), piece(2500, 5000, 1, true)]))
})

describe('normalizeZoomEdits', () => {
  const takeMs = 9000
  it('keeps null as automatic and turns non-arrays into automatic', () => {
    expect(normalizeZoomEdits(null, takeMs)).toBeNull()
    expect(normalizeZoomEdits('x', takeMs)).toBeNull()
    expect(normalizeZoomEdits(undefined, takeMs)).toBeNull()
  })
  it('keeps valid edits in time order', () => expect(normalizeZoomEdits([zoom('b', 4000, 5000), zoom('a', 1500, 3000)], takeMs)).toEqual([zoom('a', 1500, 3000), zoom('b', 4000, 5000)]))
  it('drops what cannot be a zoom', () => {
    const edits = normalizeZoomEdits(
      [
        zoom('nan', 1500, 2500, { depth: NaN }),
        zoom('aim', 1500, 2500, { aim: 'sideways' as never }),
        zoom('focus', 1500, 2500, { focus: { x: Infinity, y: 0 } }),
        { id: '', start: 1500, end: 2500, depth: 2, aim: 'auto', focus: { x: 0, y: 0 } },
        zoom('short', 3000, 3000 + ZOOM_RULES.minHoldMs - 1),
        zoom('outside', 9500, 12_000),
        zoom('mostly outside', 8500, 12_000),
        'junk',
        null
      ],
      takeMs
    )
    expect(edits).toEqual([])
  })
  it('clamps depth and holds into the take', () => {
    const [low, high] = normalizeZoomEdits([zoom('low', -500, 2000, { depth: 0.1 }), zoom('high', 5000, 12_000, { depth: 9 })], takeMs)!
    expect(low).toMatchObject({ start: 0, end: 2000, depth: ZOOM_DEPTH_RANGE.min })
    expect(high).toMatchObject({ start: 5000, end: 9000, depth: ZOOM_DEPTH_RANGE.max })
  })
  it('drops the later of two overlapping zooms and repeated ids', () => {
    const edits = normalizeZoomEdits([zoom('a', 2000, 4000), zoom('b', 3000, 5000), zoom('a', 6000, 7000), zoom('c', 4000, 5000)], takeMs)!
    expect(edits.map((edit) => edit.id)).toEqual(['a', 'c'])
  })
})

describe('draft manifest', () => {
  it('round-trips a canvas with an empty shot, a screenshot and an edited recording', () => {
    const { manifest, keys } = buildDraftManifest(shots, shots[2].id, style, '0.8.0', (r) => r.id)
    const parsed = parseDraftManifest(manifest, new Map([[keys.take.get('take1')!, track]]), new Map([[keys.image.get('img1')!, imageSize]]))
    expect(parsed.shots.map((s) => s.kind)).toEqual(['empty', 'screenshot', 'recording'])
    expect(parsed.shots[0].doc).toEqual(shots[0].doc)
    expect(parsed.shots[1].doc).toEqual({ ...shots[1].doc, sourceId: keys.image.get('img1') })
    expect(parsed.shots[2].doc).toEqual({ ...shots[2].doc, sourceId: keys.take.get('take1') })
    expect(parsed.shots.map((s) => s.defaultName)).toEqual(['brave-otter-fig', 'calm-owl-date', 'quick-fox-lime'])
    expect(parsed.style).toEqual(style)
    expect(parsed.active).toBe(2)
  })

  it('reads a shot’s name only when it is three short lowercase words', () => {
    const named = (defaultName: unknown) =>
      parseDraftManifest(JSON.stringify({ format: DRAFT_FORMAT, version: 1, shots: [{ kind: 'empty', defaultName, doc: {} }] }), new Map()).shots[0].defaultName
    expect(named('merry-lynx-plum')).toBe('merry-lynx-plum')
    for (const bad of [undefined, null, 7, '', 'Merry-Lynx-Plum', '../../evil-name-x', 'merry-lynx', 'merry-lynx-plum-pie']) expect(named(bad)).toBeNull()
  })

  it('writes the format, version, app version and a key per source', () => {
    const { manifest, keys } = buildDraftManifest(shots, 's1', style, '0.8.0', (r) => `name ${r.id}`)
    expect(JSON.parse(manifest)).toMatchObject({ format: DRAFT_FORMAT, version: DRAFT_VERSION, savedBy: '0.8.0', active: 1 })
    expect([[...keys.image.keys()], [...keys.take.keys()]]).toEqual([['img1'], ['take1']])
    expect(JSON.parse(manifest).shots[2]).toMatchObject({ kind: 'recording', name: 'name s2' })
  })

  it('shares a key between shots that show the same take', () => {
    const copy = record('s3', shots[2].doc)
    const { keys, manifest } = buildDraftManifest([shots[2], copy], 's3', style, '0.8.0', (r) => r.id)
    expect(keys.take.size).toBe(1)
    const parsed = parseDraftManifest(manifest, new Map([[keys.take.get('take1')!, track]]))
    expect(parsed.shots.map((s) => s.kind)).toEqual(['recording', 'recording'])
    expect(parsed.active).toBe(1)
  })

  it('refuses a draft from a newer Cawmera', () => expect(failure(JSON.stringify({ format: 'cawmera-draft', version: 2 }))).toBe('newer-version'))

  it('refuses anything that is not a draft', () => {
    for (const bad of ['', 'nope', '[]', 'null', '{}', JSON.stringify({ format: 'x', version: 1 }), JSON.stringify({ format: 'cawmera-draft' })]) {
      expect(failure(bad)).toBe('not-a-draft')
    }
  })

  it('calls a draft damaged when its shots are unusable', () => {
    const base = { format: DRAFT_FORMAT, version: 1 }
    const damaged = [
      base,
      { ...base, shots: [] },
      { ...base, shots: 'x' },
      { ...base, shots: [null] },
      { ...base, shots: [{ kind: 'video', doc: {} }] },
      { ...base, shots: [{ kind: 'recording', key: '../x', doc: {} }] }
    ]
    for (const bad of damaged) expect(failure(JSON.stringify(bad))).toBe('damaged')
  })

  it('calls a draft damaged when a take or a screenshot size is missing', () => {
    expect(failure(buildDraftManifest(shots, 's2', style, '0.8.0', (r) => r.id).manifest)).toBe('damaged')
    expect(failure(buildDraftManifest([shots[1]], 's1', style, '0.8.0', (r) => r.id).manifest)).toBe('damaged')
  })

  it('ignores unknown fields and falls back to the default style', () => {
    const text = JSON.stringify({ format: DRAFT_FORMAT, version: 1, extra: 1, style: 7, shots: [{ kind: 'empty', doc: { colour: 'red' }, more: true }] })
    const parsed = parseDraftManifest(text, new Map())
    expect(parsed.style).toEqual(DEFAULT_HOUSE_STYLE)
    expect(parsed.shots).toEqual([{ kind: 'empty', defaultName: null, doc: DEFAULT_DOC }])
    expect(parsed.active).toBe(0)
  })

  it('keeps the active shot inside the canvas', () => {
    const { manifest, keys } = buildDraftManifest(shots, 's2', style, '0.8.0', (r) => r.id)
    const tracks = new Map([[keys.take.get('take1')!, track]])
    const sizes = new Map([[keys.image.get('img1')!, imageSize]])
    const load = (active: unknown) => parseDraftManifest(JSON.stringify({ ...JSON.parse(manifest), active }), tracks, sizes).active
    expect([load(99), load(-3), load('x'), load(1.5)]).toEqual([0, 0, 0, 0])
  })

  it('clamps what it reads to the shot and its take', () => {
    const doc = parsedRecording({
      angle: 400,
      size: { width: 1921, height: 1081 },
      recording: { trim: { start: -5, end: 99_999 }, pieces: [piece(0, 10)], zooms: [{ id: 'z', start: 1, end: 2, depth: NaN }] }
    })
    expect(doc).toMatchObject({ angle: 40, size: { width: 1922, height: 1082 } })
    expect(doc.recording).toMatchObject({ trim: { start: 0, end: track.durationMs }, pieces: wholeTake(track.durationMs), zooms: [] })
  })

  it('defaults every recording setting a draft leaves out or gets wrong', () => {
    const missing = parsedRecording({ recording: {} }).recording!
    expect(missing).toEqual({ ...DEFAULT_RECORDING, trim: { start: 0, end: track.durationMs }, pieces: wholeTake(track.durationMs), zooms: null })
    const wrong = parsedRecording({
      recording: { cursorSize: 'big', smoothing: 7, look: 'neon', clickEffect: 4, hideWhenStill: 'yes', tilt: null, cursorBlur: NaN, cameraBlur: -2, zoomSpeed: 'fast', fps: 24 }
    }).recording!
    expect(wrong).toMatchObject({ ...DEFAULT_RECORDING, smoothing: 1, cameraBlur: 0 })
    expect(parsedRecording({ recording: { cursorSize: 99 } }).recording!.cursorSize).toBe(3)
    expect(parsedRecording({ recording: { fps: 30 } }).recording!.fps).toBe(30)
    expect(parsedRecording({ recording: null }).recording).toEqual(missing)
  })

  it('keeps shot fields valid', () => {
    const doc = parsedRecording({
      capturedAt: 'x',
      zoom: 3,
      edge: 'diagonal',
      redactStyle: 'smear',
      fill: 'paint',
      lightColor: 'red',
      lightIntensity: 5,
      fileName: 3,
      spotlight: { on: 'yes', rect: { x: NaN, y: 0, w: 1, h: 1 }, dim: 9, outline: 'no' }
    })
    expect(doc).toMatchObject({ capturedAt: 1, zoom: 1, edge: null, redactStyle: 'blur', fill: 'gradient', lightColor: null, lightIntensity: 1, fileName: '' })
    expect(doc.spotlight).toEqual({ on: false, rect: null, dim: 1, outline: true })
    expect(parsedRecording({ angle: 'x' }).angle).toBe(DEFAULT_DOC.angle)
  })

  it('settles the crop against the take and drops a crop that is not a rectangle', () => {
    expect(parsedRecording({ crop: { x: -50, y: 10, w: 100_000, h: 20 } }).crop).toEqual({ x: 0, y: 10, w: 1920, h: 64 })
    expect(parsedRecording({ crop: { x: 0, y: 0, w: 1920, h: 1080 } }).crop).toBeNull()
    expect(parsedRecording({ crop: { x: 0, y: 'a', w: 1, h: 1 } }).crop).toBeNull()
    expect(parsedRecording({ crop: 'x' }).crop).toBeNull()
  })

  it('clamps boxes to the video and settles their times on whole frames inside the take', () => {
    const box = (id: unknown, rect: unknown, time: unknown) => ({ id, rect, time })
    const small = { x: 0, y: 0, w: 10, h: 10 }
    const doc = parsedRecording({
      redactions: [
        box('a', { x: -10, y: 5, w: 5000, h: 40 }, { start: 100.5, end: 2000.4 }),
        box('b', small, null),
        box('c', { x: 0, y: 0, w: NaN, h: 10 }, { start: 600, end: 900 }),
        box('d', { x: 5000, y: 0, w: 10, h: 10 }, { start: 600, end: 900 }),
        box('e', small, { start: 8000, end: 1000 }),
        box('a', small, { start: 600, end: 900 }),
        box(7, small, { start: 600, end: 900 }),
        box('before', small, { start: -500, end: 300 }),
        box('after', small, { start: 9990, end: 12_000 })
      ]
    })
    const frameMs = 1000 / 60
    const onGrid = (ms: number) => Math.abs(ms / frameMs - Math.round(ms / frameMs)) < 1e-6
    expect(doc.redactions.map((r) => r.id)).toEqual(['a', 'before', 'after'])
    expect(doc.redactions[0].rect).toEqual({ x: 0, y: 5, w: 1920, h: 40 })
    const [time, before, after] = doc.redactions.map((redaction) => redaction.time!)
    expect(onGrid(time.start) && onGrid(time.end)).toBe(true)
    expect(time.start).toBeCloseTo(snapDownToFrame(100.5, 60), 6)
    expect(time.end).toBeGreaterThanOrEqual(2000.4)
    expect(time.end).toBeLessThan(2000.4 + frameMs)
    expect(before).toEqual({ start: 0, end: 300 })
    expect(after.start).toBeCloseTo(track.durationMs - frameMs, 6)
    expect(after.end).toBe(track.durationMs)
  })

  it('brings back a box outside the trim and a zoom across the trim’s edge as they were', () => {
    const outside: Redaction[] = [
      { id: 'early', rect: { x: 10, y: 20, w: 300, h: 100 }, time: { start: 0, end: 1000 } },
      { id: 'late', rect: { x: 10, y: 20, w: 300, h: 100 }, time: { start: 9500, end: 10_000 } }
    ]
    const acrossTheEnd = zoom('across', 8600, 9800)
    const recording: RecordingDoc = { ...DEFAULT_RECORDING, trim: { start: 2000, end: 9000 }, pieces: wholeTake(10_000), zooms: [acrossTheEnd] }
    const doc: Doc = { ...shots[2].doc, redactions: outside, recording }
    const { manifest, keys } = buildDraftManifest([record('s', doc)], 's', style, '0.8.0', (r) => r.id)
    const parsed = parseDraftManifest(manifest, new Map([[keys.take.get('take1')!, track]])).shots[0].doc
    expect(parsed.redactions).toEqual(outside)
    expect(parsed.recording!.zooms).toEqual([acrossTheEnd])
    expect(parsed).toEqual({ ...doc, sourceId: keys.take.get('take1') })
  })

  it('reads screenshot boxes without times and clamps them to the decoded image', () => {
    const { manifest, keys } = buildDraftManifest([shots[1]], 's1', style, '0.8.0', (r) => r.id)
    const tampered = JSON.parse(manifest)
    tampered.shots[0].doc.redactions = [{ id: 'r', rect: { x: 700, y: 500, w: 900, h: 900 }, time: { start: 1, end: 2 } }]
    tampered.shots[0].doc.crop = { x: -5, y: -5, w: 5000, h: 5000 }
    tampered.shots[0].doc.spotlight = { on: true, rect: { x: 100, y: 100, w: 9999, h: 50 }, dim: 0.3, outline: false }
    const doc = parseDraftManifest(JSON.stringify(tampered), new Map(), new Map([[keys.image.get('img1')!, imageSize]])).shots[0].doc
    expect(doc.redactions).toEqual([{ id: 'r', rect: { x: 700, y: 500, w: 100, h: 100 }, time: null }])
    expect(doc.crop).toBeNull()
    expect(doc.spotlight).toEqual({ on: true, rect: { x: 100, y: 100, w: 700, h: 50 }, dim: 0.3, outline: false })
    expect(doc.recording).toBeNull()
  })

  it('builds keys that fit the archive and stay apart when a screenshot and a take share an id', () => {
    const same = [record('a', { ...DEFAULT_DOC, sourceId: 'same', capturedAt: 1 }), record('b', { ...DEFAULT_DOC, sourceId: 'same', recording: editedRecording })]
    const { manifest, keys } = buildDraftManifest([...shots, ...same], 's0', style, '0.8.0', (r) => r.id)
    const entries: { key?: string }[] = JSON.parse(manifest).shots
    const all = [...new Set<string>(entries.flatMap((shot) => (shot.key ? [shot.key] : [])))]
    expect(all.length).toBe(4)
    for (const key of all) expect(key).toMatch(DRAFT_KEY)
    expect([keys.image.get('same'), keys.take.get('same')]).toEqual([entries[3].key, entries[4].key])
  })

  it('refuses keys the archive would not accept', () => {
    for (const key of ['Take1', 'take-1', '', 'a'.repeat(17), '..', 'a/b']) {
      const text = JSON.stringify({ format: DRAFT_FORMAT, version: 1, shots: [{ kind: 'recording', key, doc: {} }] })
      expect(failure(text)).toBe('damaged')
    }
  })

  it('shares the cursor size range with the panel', () => expect(parsedRecording({ recording: { cursorSize: -4 } }).recording!.cursorSize).toBe(CURSOR_SIZE_RANGE.min))

  it('settles a screenshot crop to whole pixels, or drops it when it is the whole image', () => {
    const { manifest, keys } = buildDraftManifest([shots[1]], 's1', style, '0.8.0', (r) => r.id)
    const crop = (rect: unknown) => {
      const tampered = JSON.parse(manifest)
      tampered.shots[0].doc.crop = rect
      return parseDraftManifest(JSON.stringify(tampered), new Map(), new Map([[keys.image.get('img1')!, imageSize]])).shots[0].doc.crop
    }
    expect(crop({ x: 10.4, y: 20.6, w: 100.2, h: 50.5 })).toEqual({ x: 10, y: 21, w: 101, h: 50 })
    expect(crop({ x: -3, y: 0, w: 900, h: 700 })).toBeNull()
  })

  it('refuses a manifest with more shots, boxes, zooms or pieces than Cawmera could make', () => {
    const many = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `x${i}`, rect: { x: 0, y: 0, w: 5, h: 5 }, time: { start: 600, end: 700 } }))
    const key = recordingOnly().keys.take.get('take1')!
    const read = (text: string) => { try { parseDraftManifest(text, new Map([[key, track]])); return null } catch (e) { return (e as DraftError).reason } }
    expect(read(manifestWith({ redactions: many(DRAFT_LIMITS.redactions) }))).toBeNull()
    expect(read(manifestWith({ redactions: many(DRAFT_LIMITS.redactions + 1) }))).toBe('damaged')
    expect(read(manifestWith({ recording: { zooms: Array(DRAFT_LIMITS.zooms + 1).fill(0) } }))).toBe('damaged')
    expect(read(manifestWith({ recording: { pieces: Array(DRAFT_LIMITS.pieces + 1).fill(0) } }))).toBe('damaged')
    const shotList = Array.from({ length: DRAFT_LIMITS.shots + 1 }, () => ({ kind: 'empty', doc: {} }))
    expect(failure(JSON.stringify({ format: DRAFT_FORMAT, version: 1, shots: shotList }))).toBe('damaged')
  })

  it('reads hostile input safely: it parses or throws only a draft error', () => {
    const base = { format: DRAFT_FORMAT, version: 1 }
    const nastyRecording = {
      trim: { start: 1e308, end: -1e308 },
      pieces: [{ start: -Infinity, end: 1e308, rate: 2 }, { start: 0, end: 1e300 }],
      zooms: [{ id: '__proto__', start: 1e9, end: 2e9, depth: 1e308, aim: 'auto', focus: { x: 1e308, y: -1e308 } }],
      cursorSize: 1e308,
      constructor: { prototype: { polluted: true } }
    }
    const nastyDoc = {
      __proto__: { polluted: true },
      constructor: { prototype: { polluted: true } },
      size: { width: 1e308, height: -1e308 },
      angle: 1e308,
      crop: { x: 1e308, y: 1e308, w: 1e308, h: 1e308 },
      redactions: [{ id: 'constructor', rect: { x: -1e308, y: 0, w: 1e308, h: 1e308 }, time: { start: -1e308, end: 1e308 } }, null, 5, { id: '__proto__' }],
      spotlight: { on: true, rect: { x: 1e308, y: 0, w: Infinity, h: 1 }, dim: Infinity },
      recording: nastyRecording
    }
    const shotsInput = [
      { kind: 'recording', key: 'take1', doc: nastyDoc, name: 5 },
      { kind: 'screenshot', key: 'img1', doc: nastyDoc, source: { name: {}, origin: 'elsewhere', detected: 'wide' } },
      { kind: 'empty', doc: nastyDoc }
    ]
    const text = JSON.stringify({ ...base, shots: shotsInput })
    const parsed = parseDraftManifest(text, new Map([['take1', track]]), new Map([['img1', imageSize]]))
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    for (const shot of parsed.shots) {
      expect(Number.isFinite(shot.doc.size.width) && Number.isFinite(shot.doc.angle)).toBe(true)
      expect(shot.doc.redactions.every((r) => Object.values(r.rect).every(Number.isFinite))).toBe(true)
    }
    const screenshot = parsed.shots[1]
    expect(screenshot.kind === 'screenshot' && screenshot.source.detected).toBe(1)
    const recording = parsed.shots[0].doc.recording!
    expect(Object.values(recording.trim).every(Number.isFinite)).toBe(true)
    expect(Number.isFinite(recording.cursorSize)).toBe(true)
    for (const text of ['{"format":"cawmera-draft","version":1,"shots":[{"kind":"empty","doc":{"__proto__":[]}}],"__proto__":1}', '{"format":"cawmera-draft","version":1,"shots":{"length":3}}']) {
      const outcome = failure(text)
      expect(outcome === null || outcome === 'damaged').toBe(true)
    }
  })
})
