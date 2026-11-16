import { describe, expect, it } from 'vitest'
import { angleDistance, angleName, edgeDirections, exportFileName, MIN_ANGLE_APART, normalizeAngle, randomAngle, slugify, snapDensity } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE, sanitizeHouseStyle } from '../src/renderer/src/app/house-style'
import { DEFAULT_SIZE } from '../src/renderer/src/app/size'
import { coverRect, drawScene, lightPoint } from '../src/renderer/src/render/compose'
import { clipTo, confineMove, normalize, resizeRect } from '../src/renderer/src/render/geometry'
import {
  BLEED_OVERSHOOT,
  capacity,
  centeredBox,
  computeLayout,
  contentScale,
  drawnSelection,
  moveSelection,
  openSelection,
  outputToSource,
  resizeSelection,
  scaleFor,
  settleSelection,
  sourceToOutput,
  visibleSource
} from '../src/renderer/src/render/layout'
import { shotAt, shotRects, slotAt, slotX } from '../src/renderer/src/canvas/view'
import { emptyDoc } from '../src/renderer/src/app/store'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'
import { fakeContext } from './fake-canvas'

const style = DEFAULT_HOUSE_STYLE
const big = { width: 2880, height: 1800 } // a full window captured at 2×
const small = { width: 1000, height: 600 } // a dialog captured at 2×: 1000 × 600 export px
const inset = style.inset
const out = DEFAULT_SIZE

describe('scale normalization', () => {
  it('maps one CSS px of the captured UI to one CSS px of the image at 100%, whatever the capture density', () => {
    expect(contentScale(2, 1)).toBe(1)
    expect(contentScale(1, 1)).toBe(2)
    expect(contentScale(1.5, 1)).toBeCloseTo(4 / 3)
    expect(contentScale(2, 0.6)).toBeCloseTo(0.6)
  })

  it('gives the same on-image size to the same UI captured at different densities', () => {
    for (const d of [1, 1.5, 2]) {
      const { content } = computeLayout({ width: 400 * d, height: 250 * d }, null, d, 1, null, style, out)
      expect(content.w).toBe(800)
      expect(content.h).toBe(500)
    }
  })

  it('follows the house design width: a 640 px column shows a 2× capture 25% larger', () => {
    const { content } = computeLayout({ width: 800, height: 500 }, null, 2, 1, null, { ...style, designWidth: 640 }, out)
    expect(content.w).toBe(1000)
    expect(content.h).toBe(625)
  })

  it('snaps detected densities to the offered steps', () => {
    expect(snapDensity(1)).toBe(1)
    expect(snapDensity(1.25)).toBe(1.25)
    expect(snapDensity(1.1)).toBe(1)
    expect(snapDensity(1.75)).toBe(1.5)
    expect(snapDensity(1.8)).toBe(2)
    expect(snapDensity(3)).toBe(2)
    expect(snapDensity(Number.NaN)).toBe(1)
  })
})

describe('edges', () => {
  it('reads each edge as a direction per axis', () => {
    expect(edgeDirections('br')).toEqual({ x: 1, y: 1 })
    expect(edgeDirections('t')).toEqual({ x: 0, y: -1 })
    expect(edgeDirections('l')).toEqual({ x: -1, y: 0 })
    expect(edgeDirections('c')).toEqual({ x: 0, y: 0 })
  })

  it('auto: a small screenshot sits fully inside, centered', () => {
    const layout = computeLayout(small, null, 2, 1, null, style, out)
    expect(layout.edge).toBe('c')
    expect(layout.content).toEqual({ x: 300, y: 200, w: 1000, h: 600 })
    expect(layout.frame).toEqual(layout.content)
  })

  it('auto: a big screenshot comes in from the bottom right, keeping the inset top and left', () => {
    const layout = computeLayout(big, null, 2, 1, null, style, out)
    expect(layout.edge).toBe('br')
    expect(layout.content).toEqual({ x: inset, y: inset, w: out.width - inset, h: out.height - inset })
    expect(layout.sel).toEqual({ x: 0, y: 0, w: 1504, h: 904 })
    // The frame runs past the edges, so no border or corner shows there.
    expect(layout.frame.x + layout.frame.w).toBe(out.width + BLEED_OVERSHOOT)
    expect(layout.frame.y + layout.frame.h).toBe(out.height + BLEED_OVERSHOOT)
  })

  it('auto decides each axis on its own: a wide, short strip comes in from the right and stays centered vertically', () => {
    const layout = computeLayout({ width: 2302, height: 717 }, null, 2, 1, null, style, out)
    expect(layout.edge).toBe('r')
    expect(layout.content.y).toBe(Math.round((out.height - 717) / 2))
    expect(layout.content.x).toBe(inset)
  })

  it('coming in from the left shows the right side of the screenshot', () => {
    const layout = computeLayout(big, null, 2, 1, 'bl', style, out)
    expect(layout.content.x).toBe(0)
    expect(layout.content.x + layout.content.w).toBe(out.width - inset)
    expect(layout.sel.x).toBe(big.width - 1504)
    expect(layout.frame.x).toBe(-BLEED_OVERSHOOT)
  })

  it('coming in from the top shows the bottom of the screenshot and centers it across', () => {
    const layout = computeLayout(big, null, 2, 1, 't', style, out)
    expect(layout.content.y).toBe(0)
    expect(layout.sel.y).toBe(big.height - (out.height - inset))
    expect(layout.content.x).toBe(inset)
    expect(layout.content.w).toBe(out.width - 2 * inset)
    expect(layout.frame.y).toBe(-BLEED_OVERSHOOT)
  })

  it('a small screenshot still touches the edge it comes in from, without losing any of it', () => {
    const layout = computeLayout(small, null, 2, 1, 'r', style, out)
    expect(layout.content.x + layout.content.w).toBe(out.width)
    expect(layout.sel).toEqual({ x: 0, y: 0, w: 1000, h: 600 })
    expect(layout.content.y).toBe(200)
  })

  it('inside keeps the inset on every side, even for a big screenshot', () => {
    const layout = computeLayout(big, null, 2, 1, 'c', style, out)
    expect(layout.content).toEqual({ x: inset, y: inset, w: out.width - 2 * inset, h: out.height - 2 * inset })
    expect(layout.frame).toEqual(layout.content)
  })

  it('capacity: auto allows the larger, edge-touching size; inside allows less', () => {
    const scale = scaleFor(2, 1, style)
    expect(capacity(scale, style, null, out)).toEqual({ width: 1504, height: 904 })
    expect(capacity(scale, style, 'c', out)).toEqual({ width: 1408, height: 808 })
    expect(capacity(scale, style, 'r', out)).toEqual({ width: 1504, height: 808 })
  })
})

describe('other sizes', () => {
  const og = { width: 1200, height: 630 }

  it('keeps the screenshot at the same scale whatever the size of the image', () => {
    expect(computeLayout(big, null, 2, 1, null, style, og).scale).toBe(computeLayout(big, null, 2, 1, null, style, out).scale)
    expect(computeLayout(small, null, 2, 1, null, style, { width: 1080, height: 1350 }).content.h).toBe(600)
  })

  it('an article image shows less of a big screenshot, running off its bottom right', () => {
    const layout = computeLayout(big, null, 2, 1, null, style, og)
    expect(layout.edge).toBe('br')
    expect(layout.sel).toEqual({ x: 0, y: 0, w: 1104, h: 534 })
    expect(layout.content).toEqual({ x: 96, y: 96, w: 1104, h: 534 })
    expect(layout.frame).toEqual({ x: 96, y: 96, w: 1168, h: 598 })
  })

  it('centres a screenshot that fits in a square image', () => {
    const layout = computeLayout({ width: 800, height: 500 }, null, 2, 1, null, style, { width: 1080, height: 1080 })
    expect(layout.edge).toBe('c')
    expect(layout.content).toEqual({ x: 140, y: 290, w: 800, h: 500 })
  })

  it('decides the automatic edge against the image it is in', () => {
    // Fits inside 1600 × 1000, but not across a 1080 px portrait with an inset on both sides.
    const layout = computeLayout(small, null, 2, 1, null, style, { width: 1080, height: 1350 })
    expect(layout.edge).toBe('r')
    expect(layout.content).toEqual({ x: 96, y: 375, w: 984, h: 600 })
  })

  it('measures what fits against the image it is in', () => {
    const scale = scaleFor(2, 1, style)
    expect(capacity(scale, style, null, og)).toEqual({ width: 1104, height: 534 })
    expect(capacity(scale, style, 'c', { width: 1080, height: 1350 })).toEqual({ width: 888, height: 1158 })
  })
})

describe('mapping', () => {
  it('maps the selection corner to the content corner and back', () => {
    const crop = { x: 400, y: 300, w: 600, h: 400 }
    const layout = computeLayout(big, crop, 2, 1, null, style, out)
    expect(layout.content.w).toBe(600)
    const corner = sourceToOutput(layout, { x: 400, y: 300 })
    expect(corner).toEqual({ x: layout.content.x, y: layout.content.y })
    expect(outputToSource(layout, corner)).toEqual({ x: 400, y: 300 })
  })

  it('falls back to the whole image for an empty or out-of-range selection', () => {
    const layout = computeLayout({ width: 800, height: 500 }, { x: 900, y: 900, w: 10, h: 10 }, 2, 1, null, style, out)
    expect(layout.sel).toEqual({ x: 0, y: 0, w: 800, h: 500 })
  })

  it('places new boxes inside what is visible', () => {
    const layout = computeLayout(big, null, 2, 1, null, style, out)
    const box = centeredBox(layout, 0.5, 0.5)
    const visible = visibleSource(layout)
    expect(box.x).toBeGreaterThanOrEqual(visible.x)
    expect(box.x + box.w).toBeLessThanOrEqual(visible.x + visible.w)
    expect(box.y + box.h).toBeLessThanOrEqual(visible.y + visible.h)
  })
})

describe('cropping', () => {
  const cap = capacity(scaleFor(2, 1, style), style, null, out)

  it('moves the selection without changing its size, and stops at the image edges', () => {
    const sel = { x: 100, y: 100, w: 500, h: 300 }
    expect(moveSelection(sel, big, 40, -20)).toEqual({ x: 140, y: 80, w: 500, h: 300 })
    expect(moveSelection(sel, big, -999, 99999)).toEqual({ x: 0, y: 1500, w: 500, h: 300 })
  })

  it('never lets the selection grow past what fits', () => {
    const grown = resizeSelection({ x: 200, y: 200, w: 800, h: 500 }, 'se', 5000, 0, big, cap, 24)
    expect(grown.w).toBeCloseTo(cap.width)
    expect(grown.h).toBe(500)
  })

  it('dragging the left edge keeps the right edge in place', () => {
    const r = resizeSelection({ x: 1000, y: 200, w: 600, h: 400 }, 'w', -300, 0, big, cap, 24)
    expect(r.x + r.w).toBe(1600)
    expect(r.w).toBe(900)
  })

  it('draws a new selection in any direction, anchored at the start point', () => {
    const r = drawnSelection({ x: 2000, y: 1200 }, { x: 100, y: 100 }, big, cap)
    expect(r.x + r.w).toBeCloseTo(2000)
    expect(r.y + r.h).toBeCloseTo(1200)
    expect(r.w).toBeCloseTo(cap.width)
  })

  it('keeps a full-width selection open to the edge, so a smaller UI zoom shows more of the screenshot', () => {
    const moved = moveSelection({ x: 0, y: 0, w: cap.width, h: cap.height }, big, 700, 400)
    const open = openSelection(moved, big, cap, null)
    expect(open).toEqual({ x: 700, y: 400, w: big.width - 700, h: big.height - 400 })
    const at100 = computeLayout(big, open, 2, 1, null, style, out)
    expect(at100.sel).toEqual({ x: 700, y: 400, w: 1504, h: 904 })
    const at80 = computeLayout(big, open, 2, 0.8, null, style, out)
    expect(at80.edge).toBe('br') // still running off the edges…
    expect(at80.sel.w).toBeGreaterThan(1504) // …showing more of the screenshot
    expect(at80.content.w).toBeCloseTo(out.width - inset)
  })

  it('opens towards the left / top when the frame comes in from there', () => {
    const capL = capacity(scaleFor(2, 1, style), style, 'l', out)
    const sel = { x: 600, y: 300, w: capL.width, h: 500 }
    const open = openSelection(sel, big, capL, 'l')
    expect(open).toEqual({ x: 0, y: 300, w: 600 + capL.width, h: 500 })
    // At 100% it shows exactly what was selected: the part next to the visible frame edge.
    expect(computeLayout(big, open, 2, 1, 'l', style, out).sel.x).toBe(600)
  })

  it('leaves axes that stay inside literal', () => {
    const capC = capacity(scaleFor(2, 1, style), style, 'c', out)
    const sel = { x: 100, y: 100, w: capC.width, h: capC.height }
    expect(openSelection(sel, big, capC, 'c')).toEqual(sel)
  })

  it('stores nothing when the selection is the whole image', () => {
    expect(settleSelection({ x: 0, y: 0, w: 2880, h: 1800 }, big)).toBeNull()
    expect(settleSelection({ x: 10.4, y: 0.6, w: 99.4, h: 50 }, big)).toEqual({ x: 10, y: 1, w: 100, h: 50 })
  })
})

describe('light', () => {
  it('keeps consecutive shots at least 60° apart', () => {
    for (let avoid = 0; avoid < 360; avoid += 7) {
      for (let i = 0; i < 25; i++) {
        const angle = randomAngle(avoid)
        expect(Number.isInteger(angle)).toBe(true)
        expect(angle).toBeGreaterThanOrEqual(0)
        expect(angle).toBeLessThan(360)
        expect(angleDistance(angle, avoid)).toBeGreaterThanOrEqual(MIN_ANGLE_APART)
      }
    }
    expect(randomAngle(undefined, () => 0.5)).toBe(180)
  })

  it('wraps angles round', () => {
    expect(normalizeAngle(-45)).toBe(315)
    expect(normalizeAngle(360)).toBe(0)
    expect(normalizeAngle(719.6)).toBe(0)
    expect(angleDistance(350, 10)).toBe(20)
  })

  it('moves the glow smoothly around the plate, just outside its edges', () => {
    const [tx, ty] = lightPoint(0)
    expect(tx).toBeCloseTo(0.5)
    expect(ty).toBeCloseTo(-0.06)
    const [rx, ry] = lightPoint(90)
    expect(rx).toBeCloseTo(1.04)
    expect(ry).toBeCloseTo(0.5)
    const [lx, ly] = lightPoint(315)
    expect(lx).toBeLessThan(0.2)
    expect(ly).toBeLessThan(0.1)
    for (let a = 0; a < 360; a++) {
      const [x1, y1] = lightPoint(a)
      const [x2, y2] = lightPoint(a + 1)
      expect(Math.hypot(x2 - x1, y2 - y1)).toBeLessThan(0.05)
    }
  })

  it('uses the house light by default, and new shots keep the colour and intensity but not the direction', () => {
    expect(DEFAULT_HOUSE_STYLE.glow).toMatch(/^#[0-9A-F]{6}$/)
    expect(DEFAULT_DOC.lightColor).toBeNull()
    expect(DEFAULT_DOC.lightIntensity).toBe(1)
    const previous = { ...DEFAULT_DOC, angle: 100, lightColor: '#FF7A00', lightIntensity: 0.5 }
    const next = emptyDoc(previous)
    expect(next.lightColor).toBe('#FF7A00')
    expect(next.lightIntensity).toBe(0.5)
    expect(angleDistance(next.angle, 100)).toBeGreaterThanOrEqual(MIN_ANGLE_APART)
  })

  it('names directions for people', () => {
    expect(angleName(315)).toBe('top left')
    expect(angleName(5)).toBe('top')
    expect(angleName(100)).toBe('right')
  })
})

describe('shots on the canvas', () => {
  const sizes = [out, { width: 1200, height: 630 }, { width: 1080, height: 1350 }]

  it('lays shots of any size out in a row, top-aligned, 160 px apart', () => {
    expect(shotRects(sizes)).toEqual([
      { x: 0, y: 0, w: 1600, h: 1000 },
      { x: 1760, y: 0, w: 1200, h: 630 },
      { x: 3120, y: 0, w: 1080, h: 1350 }
    ])
  })

  it('finds the shot under a point', () => {
    expect(shotAt(sizes, { x: 10, y: 10 })).toBe(0)
    expect(shotAt(sizes, { x: 1800, y: 600 })).toBe(1)
    expect(shotAt(sizes, { x: 1800, y: 700 })).toBe(-1) // below the shorter shot
    expect(shotAt(sizes, { x: 3200, y: 1300 })).toBe(2)
    expect(shotAt(sizes, { x: 1680, y: 500 })).toBe(-1) // the gap
    expect(shotAt(sizes, { x: 4300, y: 10 })).toBe(-1) // past the last shot
    expect(shotAt(sizes, { x: 10, y: -5 })).toBe(-1)
  })

  it('reorders into the slot whose neighbours are either side of the pointer', () => {
    const rects = shotRects(sizes)
    expect(slotAt(rects, 100)).toBe(0)
    expect(slotAt(rects, 900)).toBe(1)
    expect(slotAt(rects, 2400)).toBe(2)
    expect(slotAt(rects, 5000)).toBe(3)
    expect(slotX(rects, 0)).toBe(-80)
    expect(slotX(rects, 1)).toBe(1680)
    expect(slotX(rects, 3)).toBe(4280)
  })
})

describe('new shots', () => {
  it('keep the size and background of the shot before', () => {
    const next = emptyDoc({ ...DEFAULT_DOC, size: { width: 1200, height: 630 }, fill: 'image' })
    expect(next.size).toEqual({ width: 1200, height: 630 })
    expect(next.fill).toBe('image')
    expect(emptyDoc().size).toEqual({ width: 1600, height: 1000 })
    expect(emptyDoc().fill).toBe('gradient')
  })
})

describe('background image', () => {
  it('fills the whole image, cropped to fit and centred', () => {
    expect(coverRect({ width: 2400, height: 1260 }, { width: 1200, height: 630 })).toEqual({ x: 0, y: 0, w: 1200, h: 630 })
    expect(coverRect({ width: 1000, height: 1000 }, { width: 1600, height: 1000 })).toEqual({ x: 0, y: -300, w: 1600, h: 1600 })
    expect(coverRect({ width: 3000, height: 1000 }, { width: 1080, height: 1080 })).toEqual({ x: -1080, y: 0, w: 3240, h: 1080 })
  })
})

describe('redaction', () => {
  it('shrinks a blurred or pixelated box on an offscreen scratch canvas, which a hidden window can’t hibernate', () => {
    for (const redactStyle of ['blur', 'pixelate'] as const) {
      const fake = fakeContext()
      const shot = { tag: 'shot' } as unknown as CanvasImageSource
      const doc = { ...DEFAULT_DOC, redactions: [{ id: 'box', rect: { x: 200, y: 160, w: 360, h: 72 }, time: null }], redactStyle }
      drawScene(fake.ctx, { source: { image: shot, width: 1600, height: 1000 }, doc, style })
      const [small] = fake.layers
      expect(small.argsAtCall['drawImage'].map((args) => args[0])).toEqual([shot])
      expect(fake.argsAtCall['drawImage'].map((args) => args[0])).toEqual([shot, small.canvas])
    }
  })
})

describe('geometry', () => {
  it('normalizes rects drawn backwards', () => {
    expect(normalize({ x: 50, y: 40, w: -30, h: -20 })).toEqual({ x: 20, y: 20, w: 30, h: 20 })
  })

  it('keeps moved rects inside bounds without shrinking them', () => {
    expect(confineMove({ x: 90, y: -5, w: 20, h: 10 }, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 80, y: 0, w: 20, h: 10 })
  })

  it('resizes from any handle and respects the minimum size', () => {
    const start = { x: 10, y: 10, w: 50, h: 40 }
    expect(resizeRect(start, 'se', 10, 5)).toEqual({ x: 10, y: 10, w: 60, h: 45 })
    expect(resizeRect(start, 'nw', 100, 100, 6)).toEqual({ x: 54, y: 44, w: 6, h: 6 })
    expect(clipTo(resizeRect(start, 'w', -40, 0), { x: 0, y: 0, w: 200, h: 200 })).toEqual({ x: 0, y: 10, w: 60, h: 40 })
  })
})

describe('naming and house style', () => {
  it('slugifies file names the way the docs entries name images, with the chosen format', () => {
    expect(slugify('Settings Billing — Costs (current period)')).toBe('settings-billing-costs-current-period')
    expect(slugify('Café Überblick')).toBe('cafe-uberblick')
    expect(slugify('login-page-enterprise-sso.png')).toBe('login-page-enterprise-sso')
    expect(slugify('alerts.webp')).toBe('alerts')
    expect(exportFileName('', 'png', 'brave-otter-fig')).toBe('brave-otter-fig.png')
    expect(exportFileName('Edit Storage', 'webp', 'brave-otter-fig')).toBe('edit-storage.webp')
    expect(exportFileName('Launch', 'mp4', 'brave-otter-fig')).toBe('launch.mp4')
  })

  it('rejects broken values in an imported house style', () => {
    const imported = sanitizeHouseStyle({ plateFrom: 'red', inset: 9999, radius: -4, glow: '#00ff00', shadow: 'x' })
    expect(imported.plateFrom).toBe(DEFAULT_HOUSE_STYLE.plateFrom)
    expect(imported.inset).toBe(200)
    expect(imported.radius).toBe(0)
    expect(imported.glow).toBe('#00FF00')
    expect(imported.shadow).toBe(DEFAULT_HOUSE_STYLE.shadow)
    // Everything falls back to the default; a style without a name stays unnamed.
    expect(sanitizeHouseStyle(null)).toEqual({ ...DEFAULT_HOUSE_STYLE, name: '' })
  })
})
