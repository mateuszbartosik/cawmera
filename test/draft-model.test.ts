import { describe, expect, it } from 'vitest'
import { DEFAULT_DOC, type Doc, type Redaction } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE, type HouseStyle } from '../src/renderer/src/app/house-style'
import type { ShotRecord } from '../src/renderer/src/app/store'
import { buildDraftManifest, DRAFT_FORMAT, DRAFT_VERSION, DraftError, parseDraftManifest } from '../src/renderer/src/drafts/model'
import { newBoxTime } from '../src/renderer/src/recording/blur-boxes'
import { normalizePieces } from '../src/renderer/src/recording/pieces'
import { DEFAULT_RECORDING, type RecordingDoc } from '../src/renderer/src/recording/settings'
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

const record = (id: string, doc: Doc): ShotRecord => ({ id, doc, past: [], future: [], savedDoc: null })
const shots: ShotRecord[] = [
  record('s0', { ...DEFAULT_DOC, angle: 100 }),
  record('s1', { ...DEFAULT_DOC, sourceId: 'img-1', capturedAt: 2, angle: 200, redactions: [shotBox], crop: { x: 0, y: 0, w: 400, h: 300 }, fileName: 'billing' }),
  record('s2', { ...DEFAULT_DOC, sourceId: 'take-1', size: { width: 1920, height: 1080 }, redactions: [blurBox], crop: { x: 100, y: 50, w: 800, h: 600 }, recording: editedRecording })
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
  const key = recordingOnly().keys.get('take-1')!
  return parseDraftManifest(manifestWith(doc), new Map([[key, track]])).shots[0].doc
}

describe('serializeTrack', () => {
  it('round-trips a track', () => expect(parseTrack(JSON.parse(serializeTrack(track)))).toEqual(track))
  it('writes track.json version 1', () => expect(JSON.parse(serializeTrack(track))).toMatchObject({ version: 1, kind: 'monitor', durationMs: 10_000 }))
})

describe('normalizePieces', () => {
  it('falls back to the whole take for anything invalid', () => {
    for (const bad of [undefined, null, 'x', 4, {}, [], [{ start: 'a', end: 2 }]]) expect(normalizePieces(bad, 5000)).toEqual(wholeTake(5000))
  })
  it('tiles the take from valid pieces', () => expect(normalizePieces([piece(0, 2000, 2), piece(2500, 9000, 1, true)], 5000)).toEqual([piece(0, 2500, 2), piece(2500, 5000, 1, true)]))
})

describe('normalizeZoomEdits', () => {
  const trim = { start: 1000, end: 9000 }
  it('keeps null as automatic and turns non-arrays into automatic', () => {
    expect(normalizeZoomEdits(null, trim)).toBeNull()
    expect(normalizeZoomEdits('x', trim)).toBeNull()
    expect(normalizeZoomEdits(undefined, trim)).toBeNull()
  })
  it('keeps valid edits in time order', () => expect(normalizeZoomEdits([zoom('b', 4000, 5000), zoom('a', 1500, 3000)], trim)).toEqual([zoom('a', 1500, 3000), zoom('b', 4000, 5000)]))
  it('drops what cannot be a zoom', () => {
    const edits = normalizeZoomEdits(
      [
        zoom('nan', 1500, 2500, { depth: NaN }),
        zoom('aim', 1500, 2500, { aim: 'sideways' as never }),
        zoom('focus', 1500, 2500, { focus: { x: Infinity, y: 0 } }),
        { id: '', start: 1500, end: 2500, depth: 2, aim: 'auto', focus: { x: 0, y: 0 } },
        zoom('short', 3000, 3000 + ZOOM_RULES.minHoldMs - 1),
        zoom('outside', 9500, 12_000),
        'junk',
        null
      ],
      trim
    )
    expect(edits).toEqual([])
  })
  it('clamps depth and holds into the trim', () => {
    const [low, high] = normalizeZoomEdits([zoom('low', 500, 2000, { depth: 0.1 }), zoom('high', 5000, 12_000, { depth: 9 })], trim)!
    expect(low).toMatchObject({ start: 1000, end: 2000, depth: ZOOM_DEPTH_RANGE.min })
    expect(high).toMatchObject({ start: 5000, end: 9000, depth: ZOOM_DEPTH_RANGE.max })
  })
  it('drops the later of two overlapping zooms and repeated ids', () => {
    const edits = normalizeZoomEdits([zoom('a', 2000, 4000), zoom('b', 3000, 5000), zoom('a', 6000, 7000), zoom('c', 4000, 5000)], trim)!
    expect(edits.map((edit) => edit.id)).toEqual(['a', 'c'])
  })
})

describe('draft manifest', () => {
  it('round-trips a canvas with an empty shot, a screenshot and an edited recording', () => {
    const { manifest, keys } = buildDraftManifest(shots, shots[2].id, style, '0.8.0', (r) => r.id)
    const parsed = parseDraftManifest(manifest, new Map([[keys.get('take-1')!, track]]), new Map([[keys.get('img-1')!, imageSize]]))
    expect(parsed.shots.map((s) => s.kind)).toEqual(['empty', 'screenshot', 'recording'])
    expect(parsed.shots[0].doc).toEqual(shots[0].doc)
    expect(parsed.shots[1].doc).toEqual({ ...shots[1].doc, sourceId: keys.get('img-1') })
    expect(parsed.shots[2].doc).toEqual({ ...shots[2].doc, sourceId: keys.get('take-1') })
    expect(parsed.style).toEqual(style)
    expect(parsed.active).toBe(2)
  })

  it('writes the format, version, app version and a key per source', () => {
    const { manifest, keys } = buildDraftManifest(shots, 's1', style, '0.8.0', (r) => `name ${r.id}`)
    expect(JSON.parse(manifest)).toMatchObject({ format: DRAFT_FORMAT, version: DRAFT_VERSION, savedBy: '0.8.0', active: 1 })
    expect([...keys.keys()].sort()).toEqual(['img-1', 'take-1'])
    expect(JSON.parse(manifest).shots[2]).toMatchObject({ kind: 'recording', name: 'name s2' })
  })

  it('shares a key between shots that show the same take', () => {
    const copy = record('s3', shots[2].doc)
    const { keys, manifest } = buildDraftManifest([shots[2], copy], 's3', style, '0.8.0', (r) => r.id)
    expect(keys.size).toBe(1)
    const parsed = parseDraftManifest(manifest, new Map([[keys.get('take-1')!, track]]))
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
    expect(parsed.shots).toEqual([{ kind: 'empty', doc: DEFAULT_DOC }])
    expect(parsed.active).toBe(0)
  })

  it('keeps the active shot inside the canvas', () => {
    const { manifest, keys } = buildDraftManifest(shots, 's2', style, '0.8.0', (r) => r.id)
    const tracks = new Map([[keys.get('take-1')!, track]])
    const sizes = new Map([[keys.get('img-1')!, imageSize]])
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

  it('clamps boxes to the video and settles their times on whole frames inside the trim', () => {
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
        box(7, small, { start: 600, end: 900 })
      ]
    })
    const frameMs = 1000 / 60
    const bounds = newBoxTime(0, editedRecording.trim, 60, 10_000)
    const onGrid = (ms: number) => Math.abs(ms / frameMs - Math.round(ms / frameMs)) < 1e-6
    expect(doc.redactions.map((r) => r.id)).toEqual(['a'])
    expect(doc.redactions[0].rect).toEqual({ x: 0, y: 5, w: 1920, h: 40 })
    const time = doc.redactions[0].time!
    expect(onGrid(time.start) && onGrid(time.end)).toBe(true)
    expect(time.start).toBeCloseTo(bounds.start, 6)
    expect(time.end).toBeGreaterThanOrEqual(2000.4)
    expect(time.end).toBeLessThan(2000.4 + frameMs)
  })

  it('reads screenshot boxes without times and clamps them to the decoded image', () => {
    const { manifest, keys } = buildDraftManifest([shots[1]], 's1', style, '0.8.0', (r) => r.id)
    const tampered = JSON.parse(manifest)
    tampered.shots[0].doc.redactions = [{ id: 'r', rect: { x: 700, y: 500, w: 900, h: 900 }, time: { start: 1, end: 2 } }]
    tampered.shots[0].doc.crop = { x: -5, y: -5, w: 5000, h: 5000 }
    tampered.shots[0].doc.spotlight = { on: true, rect: { x: 100, y: 100, w: 9999, h: 50 }, dim: 0.3, outline: false }
    const doc = parseDraftManifest(JSON.stringify(tampered), new Map(), new Map([[keys.get('img-1')!, imageSize]])).shots[0].doc
    expect(doc.redactions).toEqual([{ id: 'r', rect: { x: 700, y: 500, w: 100, h: 100 }, time: null }])
    expect(doc.crop).toEqual({ x: 0, y: 0, w: 800, h: 600 })
    expect(doc.spotlight).toEqual({ on: true, rect: { x: 100, y: 100, w: 700, h: 50 }, dim: 0.3, outline: false })
    expect(doc.recording).toBeNull()
  })

  it('never throws anything but a draft error', () => {
    const base = { format: DRAFT_FORMAT, version: 1 }
    const odd = [{ kind: 'empty', doc: { redactions: 'x', spotlight: [], size: [] } }, { kind: 'empty', doc: 5 }]
    for (const shot of odd) expect(failure(JSON.stringify({ ...base, shots: [shot] }))).toBeNull()
  })
})
