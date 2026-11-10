import { describe, expect, it } from 'vitest'
import { buildCameraPath, cameraAt, cameraTargets, viewMatrix, ZOOM_TRANSITION_MS, type ZoomSpeed } from '../src/renderer/src/recording/camera'
import type { ZoomSegment } from '../src/renderer/src/recording/zooms'

const frame = { width: 1920, height: 1080 }
const wide = { depth: 1, focus: { x: 960, y: 540 } }
const z = (start: number, end: number, depth: number, x: number, y: number) => ({ start, end, depth, focus: { x, y } })
const stateOf = ({ depth, focus }: ZoomSegment) => ({ depth, focus })
const pathFor = (zooms: ZoomSegment[], speed: ZoomSpeed = 'calm') => buildCameraPath(cameraTargets(zooms, frame, speed), speed, frame)
const share = (depth: number, of: number) => Math.log(depth) / Math.log(of)

describe('cameraTargets', () => {
  const lead = ZOOM_TRANSITION_MS.calm

  it('aims at a zoom one settle time before it starts and goes wide when it ends', () => {
    const zoom = z(3000, 6000, 2, 500, 400)
    expect(cameraTargets([zoom], frame, 'calm')).toEqual([{ at: 3000 - lead, state: stateOf(zoom) }, { at: 6000, state: wide }])
  })

  it('goes wide between two zooms only when they are at least two settle times and 300 ms apart', () => {
    const first = z(3000, 4000, 2, 500, 400)
    const after = (gap: number) => z(4000 + gap, 8000, 2, 1500, 700)
    const apart = 2 * lead + 300
    expect(cameraTargets([first, after(apart)], frame, 'calm').map(({ at }) => at)).toEqual([3000 - lead, 4000, 4000 + apart - lead, 8000])
    expect(cameraTargets([first, after(apart - 1)], frame, 'calm').map(({ at }) => at)).toEqual([3000 - lead, 4000 + apart - 1 - lead, 8000])
  })

  it('leaves a short hold no earlier than its midpoint', () => {
    const short = z(3000, 3400, 2, 400, 400)
    const next = z(3500, 6000, 2, 800, 600)
    expect(cameraTargets([short, next], frame, 'calm')).toEqual([
      { at: 3000 - lead, state: stateOf(short) },
      { at: 3200, state: stateOf(next) },
      { at: 6000, state: wide }
    ])
  })
})

describe('cameraAt', () => {
  it('is wide with no zooms', () => expect(cameraAt(pathFor([]), 5000)).toEqual(wide))

  it('is within 2% of a zoom’s depth and focus from its start to its end', () => {
    const path = pathFor([z(3000, 6000, 2, 500, 400)])
    for (const t of [3000, 4500, 6000]) {
      const { depth, focus } = cameraAt(path, t)
      expect(share(depth, 2)).toBeGreaterThanOrEqual(0.98 - 1e-9)
      expect(Math.abs(focus.x - 500)).toBeLessThanOrEqual(0.02 * (960 - 500) + 1e-9)
      expect(Math.abs(focus.y - 400)).toBeLessThanOrEqual(0.02 * (540 - 400) + 1e-9)
    }
  })

  it('leaves a short hold’s focus no earlier than its midpoint, and is at the next one a settle time later', () => {
    const path = pathFor([z(3000, 3150, 2.5, 400, 400), z(3150, 6000, 2.5, 800, 600)])
    const leaving = cameraAt(path, 3075).focus
    expect(Math.abs(leaving.x - 400)).toBeLessThanOrEqual(0.02 * (960 - 400))
    expect(Math.abs(leaving.y - 400)).toBeLessThanOrEqual(0.02 * (540 - 400))
    const arrived = cameraAt(path, 3075 + ZOOM_TRANSITION_MS.calm).focus
    expect(Math.abs(arrived.x - 800)).toBeLessThanOrEqual(0.02 * (800 - 400))
    expect(Math.abs(arrived.y - 600)).toBeLessThanOrEqual(0.02 * (600 - 400))
  })

  it('pans straight from one close zoom’s focus to the next, through the points between them', () => {
    const path = pathFor([z(3000, 5000, 2, 400, 400), z(5200, 8000, 2, 1500, 700)], 'quick')
    const move = Array.from({ length: 1500 }, (_, i) => cameraAt(path, 4500 + i))
    for (const x of [675, 950, 1225]) {
      const passing = move.find((camera) => camera.focus.x >= x)!
      expect(passing.focus.y).toBeCloseTo(400 + ((passing.focus.x - 400) * 300) / 1100, 0)
      expect(passing.depth).toBeCloseTo(2, 3)
    }
  })

  it.each(['calm', 'quick'] as const)('starts moving ZOOM_TRANSITION_MS before a zoom, not earlier (%s)', (speed) => {
    const path = pathFor([z(3000, 6000, 2, 500, 400)], speed)
    expect(cameraAt(path, 3000 - ZOOM_TRANSITION_MS[speed] - 1)).toEqual(wide)
    expect(cameraAt(path, 3000 - ZOOM_TRANSITION_MS[speed] + 100).depth).toBeGreaterThan(1)
  })

  it('keeps position and speed continuous when the target changes mid-move', () => {
    const path = buildCameraPath([
      { at: 1000, state: { depth: 2, focus: { x: 400, y: 400 } } },
      { at: 1150, state: { depth: 2.2, focus: { x: 1500, y: 700 } } }
    ], 'calm', frame)
    let previous = cameraAt(path, 999).focus.x
    let previousStep = 0
    for (let t = 1000; t < 3000; t++) {
      const x = cameraAt(path, t).focus.x
      expect(Math.abs(x - previous - previousStep)).toBeLessThan(0.5)
      previousStep = x - previous
      previous = x
    }
  })

  it('moves straight between close zooms and goes wide between distant ones', () => {
    const close = pathFor([z(3000, 3600, 2, 400, 400), z(3900, 6000, 2.2, 1500, 700)])
    for (let t = 3600; t <= 3900; t += 10) expect(cameraAt(close, t).depth).toBeGreaterThan(1.8)
    expect(cameraAt(pathFor([z(3000, 4000, 2, 500, 400), z(8000, 9000, 2, 1500, 700)]), 6500).depth).toBeLessThan(1.02)
  })

  it('brings a quick zoom-out to rest at wide instead of stopping it dead at 1×', () => {
    const path = pathFor([z(2000, 3000, 2.5, 960, 540)], 'quick')
    const dropOver = (t: number) => cameraAt(path, t).depth - cameraAt(path, t + 1).depth
    const zoomOut = Array.from({ length: 3000 }, (_, i) => 3000 + i)
    const reachesWide = zoomOut.find((t) => cameraAt(path, t + 1).depth <= 1.001)!
    const fastest = Math.max(...zoomOut.filter((t) => t < reachesWide).map(dropOver))
    expect(dropOver(reachesWide)).toBeLessThan(0.01 * fastest)
  })

  it('never shows wider than the whole frame, even overshooting a target just above it', () => {
    const path = buildCameraPath([
      { at: 1000, state: { depth: 2.5, focus: { x: 960, y: 540 } } },
      { at: 2000, state: { depth: 1.01, focus: { x: 960, y: 540 } } }
    ], 'quick', frame)
    for (let t = 2000; t < 4000; t += 2) expect(cameraAt(path, t).depth).toBeGreaterThanOrEqual(1)
  })

  it('never shows wider than the whole frame, and quick overshoots a zoom by under 2%', () => {
    const quick = pathFor([z(2000, 2700, 2.5, 300, 300), z(3200, 3900, 1.3, 1500, 800)], 'quick')
    for (let t = 0; t < 6000; t += 5) expect(cameraAt(quick, t).depth).toBeGreaterThanOrEqual(1)
    const single = pathFor([z(3000, 6000, 2, 500, 400)], 'quick')
    for (let t = 2500; t < 6000; t += 5) expect(share(cameraAt(single, t).depth, 2)).toBeLessThan(1.02)
  })

  it('never shows past the frame’s edge, even when quick overshoots towards it', () => {
    const corners = pathFor([z(3000, 4000, 2.5, 384, 216), z(4500, 6000, 2.5, 1536, 864)], 'quick')
    for (let t = 2000; t < 8000; t += 5) {
      const { depth, focus } = cameraAt(corners, t)
      const halfView = { x: frame.width / (2 * depth), y: frame.height / (2 * depth) }
      expect(focus.x - halfView.x).toBeGreaterThanOrEqual(-1e-9)
      expect(focus.y - halfView.y).toBeGreaterThanOrEqual(-1e-9)
      expect(focus.x + halfView.x).toBeLessThanOrEqual(frame.width + 1e-9)
      expect(focus.y + halfView.y).toBeLessThanOrEqual(frame.height + 1e-9)
    }
  })

  it('takes the later of two targets set at the same time, as at a cut’s seam', () => {
    const zoom = { at: 1000, state: { depth: 2, focus: { x: 500, y: 400 } } }
    const earlier = { at: 1400, state: { depth: 1.5, focus: { x: 1200, y: 600 } } }
    const later = { at: 1400, state: { depth: 2.2, focus: { x: 800, y: 300 } } }
    const both = buildCameraPath([zoom, earlier, later], 'quick', frame)
    const laterOnly = buildCameraPath([zoom, later], 'quick', frame)
    for (const t of [1399, 1400, 1401, 2000, 4000]) {
      const actual = cameraAt(both, t)
      const expected = cameraAt(laterOnly, t)
      expect(actual.depth).toBeCloseTo(expected.depth, 9)
      expect(actual.focus.x).toBeCloseTo(expected.focus.x, 9)
      expect(actual.focus.y).toBeCloseTo(expected.focus.y, 9)
    }
  })

  it.each(['calm', 'quick'] as const)('stays continuous around short holds (%s)', (speed) => {
    const sequences = [
      [z(3000, 3150, 2, 400, 400), z(3150, 6000, 2, 800, 600)],
      [z(1000, 5000, 2, 400, 400), z(5000, 5100, 1.5, 700, 500), z(5100, 9000, 2, 900, 600)],
      [z(1000, 5000, 2, 400, 400), z(5000, 5100, 1.5, 700, 500), z(5300, 9000, 2, 900, 600)],
      [z(3000, 3150, 2, 400, 400), z(3350, 6000, 2, 800, 600)]
    ]
    for (const zooms of sequences) {
      const path = pathFor(zooms, speed)
      let previous = cameraAt(path, 0)
      for (let t = 1; t <= 12_000; t++) {
        const current = cameraAt(path, t)
        expect(Math.abs(current.depth - previous.depth)).toBeLessThan(0.05)
        expect(Math.hypot(current.focus.x - previous.focus.x, current.focus.y - previous.focus.y)).toBeLessThan(40)
        previous = current
      }
    }
  })
})

describe('viewMatrix', () => {
  const output = { width: 1920, height: 1080 }
  const layout = { content: { x: 96, y: 54, w: 1728, h: 972 }, scale: 0.675 }

  it('is the identity when wide', () => {
    expect(viewMatrix({ depth: 1, focus: { x: 1280, y: 720 } }, layout, output)).toEqual([1, 0, 0, 1, 0, 0])
  })
  it('centres the focus at full depth when it is far from the edges', () => {
    const [a, , , d, e, f] = viewMatrix({ depth: 2, focus: { x: 1280, y: 720 } }, layout, output)
    const fx = 96 + 1280 * 0.675
    const fy = 54 + 720 * 0.675
    expect(a).toBe(2)
    expect(d).toBe(2)
    expect(fx * a + e).toBeCloseTo(960)
    expect(fy * d + f).toBeCloseTo(540)
  })
  it('never shows outside the composition', () => {
    const [a, , , , e] = viewMatrix({ depth: 2, focus: { x: 0, y: 0 } }, layout, output)
    expect(e).toBeLessThanOrEqual(0)
    expect(1920 * a + e).toBeGreaterThanOrEqual(1920)
  })
})
