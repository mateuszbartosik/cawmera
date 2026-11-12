import { describe, expect, it } from 'vitest'
import { buildCameraPath, cameraAt, cameraTargets, ZOOM_TRANSITION_MS, type ZoomSpeed } from '../src/renderer/src/recording/camera'
import { DEFAULT_RECORDING } from '../src/renderer/src/recording/settings'
import { takeViewFor, type TakeView } from '../src/renderer/src/recording/take-view'
import { mapTrack, timeMapOf, wholeTake, type Piece, type Rate, type Span, type TimeMap } from '../src/renderer/src/recording/timemap'
import type { Click } from '../src/renderer/src/recording/track'
import {
  addZoom,
  clicksCovered,
  editsFromSegments,
  materialize,
  moveZoom,
  removeZoom,
  segmentsFromEdits,
  setZoom,
  stretchZoom,
  ZOOM_DEPTH_RANGE,
  type ZoomEdit
} from '../src/renderer/src/recording/zoom-edits'
import { autoZooms, clickGroupsAtDepth, type ZoomSegment } from '../src/renderer/src/recording/zooms'
import type { Rect } from '../src/renderer/src/render/geometry'

const frame = { width: 1920, height: 1080 }
const whole: Rect = { x: 0, y: 0, w: 1920, h: 1080 }
const trim = { start: 0, end: 10_000 }
const click = (t: number, x: number, y: number, button: Click['button'] = 'left'): Click => ({ t, x, y, button, up: t + 80 })
const piece = (start: number, end: number, rate: Rate = 1, cut = false): Piece => ({ start, end, rate, cut })
const z = (start: number, end: number, depth: number, x: number, y: number): ZoomSegment => ({ start, end, depth, focus: { x, y } })
const edit = (id: string, start: number, end: number): ZoomEdit => ({ id, start, end, depth: 2, aim: 'manual', focus: { x: 960, y: 540 } })
const autoEdit = (id: string, start: number, end: number, depth: number): ZoomEdit => ({ id, start, end, depth, aim: 'auto', focus: { x: 960, y: 540 } })

const wholeMap = timeMapOf({ start: 0, end: 20_000 }, wholeTake(20_000))
const viewFor = (map: TimeMap, clicks: Click[] = [], crop = whole): Pick<TakeView, 'map' | 'crop' | 'frame' | 'track'> => {
  const take = { kind: 'monitor' as const, ...frame, fps: 60, durationMs: 20_000, scale: 1, cursor: [], clicks }
  return { map, crop, frame: { width: crop.w, height: crop.h }, track: mapTrack(take, map, crop) }
}
const viewWithClicks = (clicks: Click[]) => viewFor(wholeMap, clicks)

function expectSameZooms(actual: ZoomSegment[], expected: ZoomSegment[]) {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((zoom, i) => {
    const { start, end, depth, focus } = expected[i]
    for (const [value, wanted] of [[zoom.start, start], [zoom.end, end], [zoom.depth, depth], [zoom.focus.x, focus.x], [zoom.focus.y, focus.y]]) {
      expect(Math.abs(value - wanted)).toBeLessThanOrEqual(1e-6)
    }
    expect(zoom.follow).toBeUndefined()
  })
}

describe('automatic zooms as edits', () => {
  const clicks = [
    click(1200, 700, 400),
    click(5000, 300, 540),
    click(5500, 802, 540),
    click(10_000, 100, 100),
    click(11_000, 1800, 1000),
    click(14_000, 900, 500, 'right'),
    click(15_000, -5, 100),
    click(17_500, 1500, 800)
  ]
  const map = wholeMap
  const view = viewWithClicks(clicks)

  it('turns automatic zooms into edits and back without moving them', () => {
    const segments = autoZooms(clicks, frame, { start: 0, end: 20_000 }, 'calm')
    const edits = editsFromSegments(segments, map, whole)
    expect(edits.every((e) => e.aim === 'auto' && e.id.startsWith('auto-'))).toBe(true)
    expectSameZooms(segmentsFromEdits(edits, view, 'calm'), segments)
  })

  it.each(['calm', 'quick'] as const)('round trips zooms clamped at the edges, met at a midpoint, or as deep as their clicks allow (%s)', (speed) => {
    const segments = autoZooms(clicks, frame, { start: 0, end: 20_000 }, speed)
    expect(segments.map(({ start, end }) => [start, end])).toEqual([
      [1000 + ZOOM_TRANSITION_MS[speed], 2700],
      [4900, 7000],
      [9900, 10_500],
      [10_500, 12_500],
      [17_400, 19_000 - ZOOM_TRANSITION_MS[speed]]
    ])
    expect(segments[1].depth).toBe(1920 / 886)
    expectSameZooms(segmentsFromEdits(editsFromSegments(segments, map, whole), view, speed), segments)
  })

  it('gives automatic zooms their own ids on the first edit', () => {
    const autoEdits = editsFromSegments(autoZooms([click(3000, 500, 300), click(8000, 1400, 700)], frame, { start: 0, end: 20_000 }, 'calm'), map, whole)
    let n = 0
    const { edits, ids } = materialize(autoEdits, () => `z${++n}`)
    expect(edits.map((e) => e.id)).toEqual(['z1', 'z2'])
    expect(ids.get('auto-1')).toBe('z2')
  })

  it('keeps the ids of zooms already stored', () => {
    const { edits, ids } = materialize([edit('mine', 1000, 3000), autoEdit('auto-0', 5000, 7000, 2)], () => 'new')
    expect(edits.map((e) => e.id)).toEqual(['mine', 'new'])
    expect([...ids]).toEqual([['auto-0', 'new']])
  })

  it('stores the hold in source ms and the focus in video px', () => {
    const cutAndCropped = timeMapOf({ start: 1000, end: 20_000 }, [piece(0, 4000), piece(4000, 6000, 1, true), piece(6000, 20_000)])
    const [stored] = editsFromSegments([z(2500, 4000, 2, 600, 300)], cutAndCropped, { x: 40, y: 20, w: 1800, h: 1000 })
    expect(stored).toEqual({ id: 'auto-0', start: 3500, end: 7000, depth: 2, aim: 'auto', focus: { x: 640, y: 320 } })
  })
})

describe('storing the automatic zooms', () => {
  interface Take { clicks: Click[]; durationMs: number; trim: Span }
  const wanderAt = (t: number) => ({ x: 960 + 700 * Math.sin(t / 1700), y: 540 + 380 * Math.sin(t / 2300 + 1) })
  const onWanderPath = (t: number) => click(t, wanderAt(t).x, wanderAt(t).y)
  const wholeOf = (clicks: Click[]): Take => ({ clicks, durationMs: 20_000, trim: { start: 0, end: 20_000 } })
  const takes: Record<string, Take> = {
    'stage 1’s wandering take': { clicks: [900, 2500, 4200, 5000, 7600, 8400, 10_400].map(onWanderPath), durationMs: 12_000, trim: { start: 1003, end: 10_997 } },
    'the realistic take': { clicks: [click(1200, 480, 300), click(2400, 520, 320), click(6000, 1000, 700)], durationMs: 9100, trim: { start: 0, end: 8400 } },
    'a take whose click the automatic zooms dropped where two zooms met': wholeOf([click(6000, 100, 100), click(6300, 1800, 1000)]),
    'a take whose click the automatic zooms dropped in the first second': wholeOf([click(300, 1700, 900), click(1500, 200, 200)]),
    'a take whose click the automatic zooms dropped inside the last zoom': wholeOf([click(16_000, 500, 500), click(16_800, 520, 520), click(17_800, 1800, 1000)])
  }
  const viewOf = ({ clicks, durationMs, trim: takeTrim }: Take, zoomSpeed: ZoomSpeed, zooms: ZoomEdit[] | null = null) => takeViewFor(
    { id: 'stored', name: 'Recording', poster: null, track: { kind: 'monitor', ...frame, fps: 60, durationMs, scale: 1, cursor: [], clicks } },
    { ...DEFAULT_RECORDING, trim: takeTrim, pieces: wholeTake(durationMs), zooms, zoomSpeed },
    null
  )
  const stored = (view: TakeView) => {
    let n = 0
    return materialize(view.edits, () => `zoom-${++n}`).edits
  }
  const cases = Object.keys(takes).flatMap((name) => (['calm', 'quick'] as const).map((speed) => [name, speed] as const))

  it.each(cases)('moves no zoom of %s (%s)', (name, speed) => {
    const automatic = viewOf(takes[name], speed)
    expect(automatic.zooms.length).toBeGreaterThan(0)
    expectSameZooms(segmentsFromEdits(automatic.edits, automatic, speed), automatic.zooms)
    const edited = viewOf(takes[name], speed, stored(automatic))
    expectSameZooms(edited.zooms, automatic.zooms)
    for (let t = 0; t <= automatic.map.outputMs; t += 5) {
      const [now, before] = [cameraAt(edited.camera, t), cameraAt(automatic.camera, t)]
      expect(Math.abs(now.depth - before.depth) + Math.abs(now.focus.x - before.focus.x) + Math.abs(now.focus.y - before.focus.y)).toBeLessThanOrEqual(1e-6)
    }
  })

  it.each(['stage 1’s wandering take', 'the realistic take'])('leaves the other zooms of %s where they were when one is moved, deepened or deleted', (name) => {
    for (const speed of ['calm', 'quick'] as const) {
      const automatic = viewOf(takes[name], speed)
      const edits = stored(automatic)
      const [first] = edits
      expect(edits.length).toBeGreaterThan(1)
      expectSameZooms(viewOf(takes[name], speed, moveZoom(edits, first.id, first.start + 300, takes[name].trim)).zooms.slice(1), automatic.zooms.slice(1))
      expectSameZooms(viewOf(takes[name], speed, setZoom(edits, first.id, { depth: 3 })).zooms.slice(1), automatic.zooms.slice(1))
      expectSameZooms(viewOf(takes[name], speed, removeZoom(edits, first.id)).zooms, automatic.zooms.slice(1))
    }
  })

  describe('the clicks after the last zoom’s end', () => {
    const wandering = takes['stage 1’s wandering take']
    const automatic = viewOf(wandering, 'calm')
    const edits = stored(automatic)
    const last = edits[edits.length - 1]
    const coveredTimes = (changed: ZoomEdit[]) => clicksCovered(changed[changed.length - 1], { ...automatic, edits: changed }, 'calm').map((c) => Math.round(c.t))

    it('stay covered while the zoom’s end sits on the last second’s boundary', () => {
      expect(automatic.zooms.at(-1)!.end).toBe(wandering.trim.end - wandering.trim.start - 1000 - ZOOM_TRANSITION_MS.calm)
      expect(coveredTimes(edits)).toEqual([6597, 7397, 9397])
      const laterStart = stretchZoom(edits, last.id, 'start', last.start + 50, wandering.trim)
      expect(coveredTimes(laterStart)).toEqual([6597, 7397, 9397])
      expect(segmentsFromEdits(laterStart, automatic, 'calm').at(-1)!.focus).toEqual(automatic.zooms.at(-1)!.focus)
    })

    it('go to a zoom added over them', () => {
      const withAdded = addZoom(stretchZoom(edits, last.id, 'start', last.start + 50, wandering.trim), 10_300, { x: 960, y: 540 }, wandering.trim, 'added')!
      const covered = (id: string) => clicksCovered(withAdded.find((zoom) => zoom.id === id)!, { ...automatic, edits: withAdded }, 'calm').map((c) => Math.round(c.t))
      expect(covered(last.id)).toEqual([6597, 7397])
      expect(covered('added')).toEqual([9397])
    })

    it('aren’t covered once the zoom is moved or stretched away from it', () => {
      expect(coveredTimes(stretchZoom(edits, last.id, 'end', last.end - 100, wandering.trim))).toEqual([6597, 7397])
      expect(coveredTimes(moveZoom(edits, last.id, last.start - 100, wandering.trim))).toEqual([6597, 7397])
      expect(segmentsFromEdits(moveZoom(edits, last.id, last.start - 100, wandering.trim), automatic, 'calm').at(-1)!.focus).not.toEqual(automatic.zooms.at(-1)!.focus)
    })
  })
})

describe('editing zooms', () => {
  it('moves a zoom between its neighbours and inside the trim', () => {
    const edits = [edit('a', 2000, 4000), edit('b', 6000, 8000)]
    expect(moveZoom(edits, 'a', 5000, trim)[0]).toMatchObject({ start: 4000, end: 6000 })
    expect(moveZoom(edits, 'a', -500, trim)[0]).toMatchObject({ start: 0, end: 2000 })
  })

  it('moves a zoom left partly past the trim back inside it, and leaves one with no room for its length where it is', () => {
    const edits = [edit('a', 2000, 4000), edit('b', 9000, 11_000)]
    expect(moveZoom(edits, 'b', 9500, trim)[1]).toMatchObject({ start: 8000, end: 10_000 })
    const crowded = [edit('a', 2000, 8500), edit('b', 9000, 11_000)]
    expect(moveZoom(crowded, 'b', 8600, trim)).toBe(crowded)
  })

  it('stretches a zoom to at least 600 ms and not into a neighbour', () => {
    const edits = [edit('a', 2000, 4000), edit('b', 6000, 8000)]
    expect(stretchZoom(edits, 'a', 'end', 9000, trim)[0].end).toBe(6000)
    expect(stretchZoom(edits, 'a', 'end', 2100, trim)[0].end).toBe(2600)
  })

  it('stretches a zoom’s start back to the zoom before it or the trim start, and keeps 600 ms', () => {
    const edits = [edit('a', 2000, 4000), edit('b', 6000, 8000)]
    expect(stretchZoom(edits, 'b', 'start', 1000, trim)[1].start).toBe(4000)
    expect(stretchZoom(edits, 'b', 'start', 7900, trim)[1].start).toBe(7400)
    expect(stretchZoom(edits, 'a', 'start', -300, trim)[0].start).toBe(0)
  })

  it('adds a 2 s manual zoom at 2× where there is room, and none where there isn’t', () => {
    expect(addZoom([], 3000, { x: 100, y: 100 }, trim, 'n'))
      .toEqual([{ id: 'n', start: 3000, end: 5000, depth: 2, aim: 'manual', focus: { x: 100, y: 100 } }])
    expect(addZoom([edit('a', 2000, 4000), edit('b', 4300, 8000)], 4100, { x: 0, y: 0 }, trim, 'n')).toBeNull()
  })

  it('starts a new zoom after the zoom it lands on, and stops it at the next zoom and at the trim end', () => {
    const edits = [edit('a', 2000, 4000), edit('b', 5000, 8000)]
    const holds = (added: ZoomEdit[] | null) => added?.map(({ id, start, end }) => [id, start, end])
    expect(holds(addZoom(edits, 3000, { x: 10, y: 20 }, trim, 'n'))).toEqual([['a', 2000, 4000], ['n', 4000, 5000], ['b', 5000, 8000]])
    expect(holds(addZoom(edits, 8500, { x: 10, y: 20 }, trim, 'n'))).toEqual([['a', 2000, 4000], ['b', 5000, 8000], ['n', 8500, 10_000]])
    expect(addZoom(edits, 9600, { x: 10, y: 20 }, trim, 'n')).toBeNull()
    expect(addZoom([edit('a', 2000, 4000), edit('b', 4000, 8000)], 3000, { x: 10, y: 20 }, trim, 'n')).toBeNull()
  })

  it('removes a zoom, and sets one’s depth from 1.2× to 3×, aim and focus', () => {
    const edits = [edit('a', 2000, 4000), edit('b', 6000, 8000)]
    expect(removeZoom(edits, 'a')).toEqual([edits[1]])
    const changed = setZoom(edits, 'b', { depth: 2.4, aim: 'auto', focus: { x: 100, y: 200 } })
    expect(changed).toEqual([edits[0], { ...edits[1], depth: 2.4, aim: 'auto', focus: { x: 100, y: 200 } }])
    expect(changed[0]).toBe(edits[0])
    expect(setZoom(edits, 'b', { depth: 5 })[1].depth).toBe(ZOOM_DEPTH_RANGE.max)
    expect(setZoom(edits, 'b', { depth: 1 })[1].depth).toBe(ZOOM_DEPTH_RANGE.min)
  })
})

describe('aiming a zoom', () => {
  it('follows clicks group by group when they don’t fit at the chosen depth', () => {
    const view = viewWithClicks([click(3000, 500, 300), click(4000, 1300, 700)])
    const deep = segmentsFromEdits([{ id: 'a', start: 2900, end: 5500, depth: 3, aim: 'auto', focus: { x: 960, y: 540 } }], view, 'calm')[0]
    expect(deep.follow).toEqual([{ at: 3900, focus: expect.any(Object) }])
    const shallow = segmentsFromEdits([{ id: 'a', start: 2900, end: 5500, depth: 1.2, aim: 'auto', focus: { x: 960, y: 540 } }], view, 'calm')[0]
    expect(shallow.follow ?? []).toEqual([])
  })

  it('aims at each group’s padded box, kept inside the frame', () => {
    const view = viewWithClicks([click(3000, 500, 300), click(4000, 1300, 700)])
    const [zoom] = segmentsFromEdits([autoEdit('a', 2900, 5500, 3)], view, 'calm')
    expect(zoom.focus).toEqual({ x: 500, y: 300 })
    expect(zoom.follow).toEqual([{ at: 3900, focus: { x: 1300, y: 700 } }])
    const [corner] = segmentsFromEdits([autoEdit('a', 2900, 5500, 3)], viewWithClicks([click(3000, 20, 1070)]), 'calm')
    expect(corner.focus).toEqual({ x: 320, y: 900 })
  })

  it('starts the move on to the next group no earlier than the last click of the group before it', () => {
    const view = viewWithClicks([click(3000, 500, 300), click(3300, 1300, 700)])
    for (const speed of ['calm', 'quick'] as const) {
      const [zoom] = segmentsFromEdits([autoEdit('a', 2900, 5500, 3)], view, speed)
      expect(cameraTargets([zoom], frame, speed)).toContainEqual({ at: 3000, state: { depth: 3, focus: { x: 1300, y: 700 } } })
    }
  })

  it('aims a manual zoom at its focus in the cropped frame, kept inside it, whatever its clicks', () => {
    const crop = { x: 200, y: 100, w: 1600, h: 900 }
    const view = viewFor(wholeMap, [click(3000, 1000, 500), click(3500, 1600, 900)], crop)
    const manual: ZoomEdit = { ...edit('m', 2000, 4000), depth: 3, focus: { x: 300, y: 1000 } }
    expect(segmentsFromEdits([manual], view, 'calm')).toEqual([{ start: 2000, end: 4000, depth: 3, focus: { x: 1600 / 6, y: 750 } }])
  })

  it('aims an Auto zoom without clicks at its stored focus', () => {
    const quiet: ZoomEdit = { ...autoEdit('q', 2000, 4000, 2), focus: { x: 1700, y: 100 } }
    expect(segmentsFromEdits([quiet], viewWithClicks([click(8000, 500, 500)]), 'calm')).toEqual([{ start: 2000, end: 4000, depth: 2, focus: { x: 1440, y: 270 } }])
  })

  it('aims zooms given out of order in time order, each at its own clicks', () => {
    const view = viewWithClicks([click(3000, 500, 300), click(7000, 1400, 800)])
    const segments = segmentsFromEdits([autoEdit('later', 6500, 8000, 2), autoEdit('earlier', 2500, 4000, 2)], view, 'calm')
    expect(segments.map(({ start, focus }) => [start, focus])).toEqual([[2500, { x: 500, y: 300 }], [6500, { x: 1400, y: 800 }]])
  })

  it('drops a zoom whose hold is cut and shortens one across a cut', () => {
    const cutView = viewFor(timeMapOf({ start: 0, end: 20_000 }, [piece(0, 4000), piece(4000, 6000, 1, true), piece(6000, 20_000)]))
    const segments = segmentsFromEdits([edit('inside', 4200, 5800), edit('across', 3000, 7000)], cutView, 'calm')
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ start: 3000, end: 5000 })
  })

  it('drops a zoom that a speed-up leaves under 300 ms and keeps one left with 300 ms', () => {
    const fast = viewFor(timeMapOf({ start: 0, end: 20_000 }, [piece(0, 4000), piece(4000, 8000, 8), piece(8000, 20_000)]))
    const segments = segmentsFromEdits([edit('short', 4000, 5592), edit('kept', 5600, 8000)], fast, 'calm')
    expect(segments).toEqual([{ start: 4200, end: 4500, depth: 2, focus: { x: 960, y: 540 } }])
  })
})

describe('the clicks a zoom covers', () => {
  it('counts the clicks in its hold and in the settle time before it', () => {
    const clicks = [click(1000, 500, 500), click(2200, 520, 500), click(3500, 540, 500), click(4100, 560, 500), click(6500, 580, 500), click(9000, 600, 500)]
    const edits = [autoEdit('a', 3000, 5000, 2), autoEdit('b', 6000, 8000, 2)]
    const view = { ...viewWithClicks(clicks), edits }
    expect(clicksCovered(edits[0], view, 'calm').map((c) => c.t)).toEqual([2200, 3500, 4100])
    expect(clicksCovered(edits[1], view, 'calm').map((c) => c.t)).toEqual([6500])
    expect(clicksCovered(edits[0], view, 'quick').map((c) => c.t)).toEqual([3500, 4100])
  })

  it('leaves out clicks another zoom holds, and gives a click before two zooms to the nearer one', () => {
    const edits = [autoEdit('a', 3000, 5000, 2), autoEdit('b', 5300, 5900, 2), autoEdit('c', 6000, 8000, 2)]
    const view = { ...viewWithClicks([click(4600, 500, 500), click(5250, 520, 500), click(5950, 540, 500)]), edits }
    expect(clicksCovered(edits[0], view, 'calm').map((c) => c.t)).toEqual([4600])
    expect(clicksCovered(edits[1], view, 'calm').map((c) => c.t)).toEqual([5250])
    expect(clicksCovered(edits[2], view, 'calm').map((c) => c.t)).toEqual([5950])
  })

  it('counts only shown clicks, in output ms and frame px', () => {
    const map = timeMapOf({ start: 1000, end: 20_000 }, wholeTake(20_000))
    const crop = { x: 100, y: 50, w: 1600, h: 900 }
    const zoom = autoEdit('a', 3000, 6000, 2)
    const view = { ...viewFor(map, [click(4000, 600, 400), click(4500, 700, 400, 'right'), click(5000, 50, 400)], crop), edits: [zoom] }
    expect(clicksCovered(zoom, view, 'calm')).toEqual([{ t: 3000, x: 500, y: 350, button: 'left', up: 3080 }])
  })
})

describe('clickGroupsAtDepth', () => {
  it('groups clicks in time order while they fit in view at the depth', () => {
    const left = click(1000, 300, 500)
    const right = click(2000, 1500, 500)
    const leftAgain = click(3000, 320, 520)
    expect(clickGroupsAtDepth([left, right, leftAgain], frame, 3)).toEqual([[left], [right], [leftAgain]])
    expect(clickGroupsAtDepth([left, right, leftAgain], frame, 1.2)).toEqual([[left, right, leftAgain]])
  })

  it('keeps clicks together at the depth their own padded box gives, despite rounding', () => {
    const pair = [click(1000, 300, 540), click(1500, 802, 540)]
    expect(clickGroupsAtDepth(pair, frame, 1920 / 886)).toEqual([pair])
  })
})

describe('the camera on a zoom that follows its clicks', () => {
  const pathFor = (zooms: ZoomSegment[], speed: ZoomSpeed = 'calm') => buildCameraPath(cameraTargets(zooms, frame, speed), speed, frame)

  it('aims the camera at each followed group in turn', () => {
    const targets = cameraTargets([{ ...z(3000, 6000, 3, 400, 300), follow: [{ at: 4500, focus: { x: 1300, y: 700 } }] }], frame, 'calm')
    expect(targets).toContainEqual({ at: 4500 - ZOOM_TRANSITION_MS.calm, state: { depth: 3, focus: { x: 1300, y: 700 } } })
  })

  it('is on each group by its time and stays continuous while it pans between them', () => {
    const following = { ...z(3000, 7000, 3, 400, 300), follow: [{ at: 5000, focus: { x: 1300, y: 700 } }] }
    // One settle time into the pan the camera is 2% short of it, plus what is left of the move into the zoom: a hair more.
    const twoPercentOfThePan = { x: 1.001 * 0.02 * 900, y: 1.001 * 0.02 * 400 }
    for (const speed of ['calm', 'quick'] as const) {
      const path = pathFor([following], speed)
      for (const [t, focus] of [[3000, following.focus], [5000 - ZOOM_TRANSITION_MS[speed], following.focus], [5000, { x: 1300, y: 700 }], [7000, { x: 1300, y: 700 }]] as const) {
        const camera = cameraAt(path, t)
        expect(Math.abs(camera.focus.x - focus.x)).toBeLessThanOrEqual(twoPercentOfThePan.x)
        expect(Math.abs(camera.focus.y - focus.y)).toBeLessThanOrEqual(twoPercentOfThePan.y)
        expect(Math.log(camera.depth) / Math.log(3)).toBeGreaterThanOrEqual(0.98 - 1e-9)
      }
      let previous = cameraAt(path, 0)
      for (let t = 1; t <= 10_000; t++) {
        const current = cameraAt(path, t)
        expect(Math.abs(current.depth - previous.depth)).toBeLessThan(0.05)
        expect(Math.hypot(current.focus.x - previous.focus.x, current.focus.y - previous.focus.y)).toBeLessThan(40)
        previous = current
      }
    }
  })

  it('never pans to a followed group before the camera enters its zoom', () => {
    const short = z(3000, 3400, 2, 400, 400)
    const following = { ...z(3500, 6000, 2, 800, 600), follow: [{ at: 3700, focus: { x: 1400, y: 700 } }] }
    const targets = cameraTargets([short, following], frame, 'calm')
    const times = targets.map(({ at }) => at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(targets.at(-2)).toEqual({ at: 3200, state: { depth: 2, focus: { x: 1400, y: 700 } } })
  })

  it('moves on to a close next zoom no earlier than the last pan it started, and ends up on it', () => {
    const first = { ...z(2000, 5000, 3, 400, 300), follow: [{ at: 5200, focus: { x: 1300, y: 700 } }] }
    const next = z(5000, 7000, 2, 900, 500)
    const times = cameraTargets([first, next], frame, 'calm').map(({ at }) => at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    const held = cameraAt(pathFor([first, next]), 6900)
    expect(held.depth).toBeCloseTo(2, 2)
    expect(held.focus.x).toBeCloseTo(900, 0)
    expect(held.focus.y).toBeCloseTo(500, 0)
  })
})
