import { describe, expect, it } from 'vitest'
import { angleDistance, angleName, edgeDirections, exportFileName, MIN_ANGLE_APART, normalizeAngle, randomAngle, slugify, snapDensity } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE, OUTPUT, sanitizeHouseStyle } from '../src/renderer/src/app/house-style'
import { lightPoint } from '../src/renderer/src/render/compose'
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
import { shotAt, shotRect, SHOT_GAP } from '../src/renderer/src/canvas/view'
import { emptyDoc } from '../src/renderer/src/app/store'
import { DEFAULT_DOC } from '../src/renderer/src/app/doc'

const style = DEFAULT_HOUSE_STYLE
const big = { width: 2880, height: 1800 } // a full window captured at 2×
const small = { width: 1000, height: 600 } // a dialog captured at 2×: 1000 × 600 export px
const inset = style.inset

describe('scale normalization', () => {
  it('maps one CSS px of the captured UI to one CSS px of the image at 100%, whatever the capture density', () => {
    expect(contentScale(2, 1)).toBe(1)
    expect(contentScale(1, 1)).toBe(2)
    expect(contentScale(1.5, 1)).toBeCloseTo(4 / 3)
    expect(contentScale(2, 0.6)).toBeCloseTo(0.6)
  })

  it('gives the same on-image size to the same UI captured at different densities', () => {
    for (const d of [1, 1.5, 2]) {
      const { content } = computeLayout({ width: 400 * d, height: 250 * d }, null, d, 1, null, style)
      expect(content.w).toBe(800)
      expect(content.h).toBe(500)
    }
  })

  it('follows the house design width: a 640 px column shows a 2× capture 25% larger', () => {
    const { content } = computeLayout({ width: 800, height: 500 }, null, 2, 1, null, { ...style, designWidth: 640 })
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
    const layout = computeLayout(small, null, 2, 1, null, style)
    expect(layout.edge).toBe('c')
    expect(layout.content).toEqual({ x: 300, y: 200, w: 1000, h: 600 })
    expect(layout.frame).toEqual(layout.content)
  })

  it('auto: a big screenshot comes in from the bottom right, keeping the inset top and left', () => {
    const layout = computeLayout(big, null, 2, 1, null, style)
    expect(layout.edge).toBe('br')
    expect(layout.content).toEqual({ x: inset, y: inset, w: OUTPUT.width - inset, h: OUTPUT.height - inset })
    expect(layout.sel).toEqual({ x: 0, y: 0, w: 1504, h: 904 })
    // The frame runs past the edges, so no border or corner shows there.
    expect(layout.frame.x + layout.frame.w).toBe(OUTPUT.width + BLEED_OVERSHOOT)
    expect(layout.frame.y + layout.frame.h).toBe(OUTPUT.height + BLEED_OVERSHOOT)
  })

  it('auto decides each axis on its own: a wide, short strip comes in from the right and stays centered vertically', () => {
    const layout = computeLayout({ width: 2302, height: 717 }, null, 2, 1, null, style)
    expect(layout.edge).toBe('r')
    expect(layout.content.y).toBe(Math.round((OUTPUT.height - 717) / 2))
    expect(layout.content.x).toBe(inset)
  })

  it('coming in from the left shows the right side of the screenshot', () => {
    const layout = computeLayout(big, null, 2, 1, 'bl', style)
    expect(layout.content.x).toBe(0)
    expect(layout.content.x + layout.content.w).toBe(OUTPUT.width - inset)
    expect(layout.sel.x).toBe(big.width - 1504)
    expect(layout.frame.x).toBe(-BLEED_OVERSHOOT)
  })

  it('coming in from the top shows the bottom of the screenshot and centers it across', () => {
    const layout = computeLayout(big, null, 2, 1, 't', style)
    expect(layout.content.y).toBe(0)
    expect(layout.sel.y).toBe(big.height - (OUTPUT.height - inset))
    expect(layout.content.x).toBe(inset)
    expect(layout.content.w).toBe(OUTPUT.width - 2 * inset)
    expect(layout.frame.y).toBe(-BLEED_OVERSHOOT)
  })

  it('a small screenshot still touches the edge it comes in from, without losing any of it', () => {
    const layout = computeLayout(small, null, 2, 1, 'r', style)
    expect(layout.content.x + layout.content.w).toBe(OUTPUT.width)
    expect(layout.sel).toEqual({ x: 0, y: 0, w: 1000, h: 600 })
    expect(layout.content.y).toBe(200)
  })

  it('inside keeps the inset on every side, even for a big screenshot', () => {
    const layout = computeLayout(big, null, 2, 1, 'c', style)
    expect(layout.content).toEqual({ x: inset, y: inset, w: OUTPUT.width - 2 * inset, h: OUTPUT.height - 2 * inset })
    expect(layout.frame).toEqual(layout.content)
  })

  it('capacity: auto allows the larger, edge-touching size; inside allows less', () => {
    const scale = scaleFor(2, 1, style)
    expect(capacity(scale, style, null)).toEqual({ width: 1504, height: 904 })
    expect(capacity(scale, style, 'c')).toEqual({ width: 1408, height: 808 })
    expect(capacity(scale, style, 'r')).toEqual({ width: 1504, height: 808 })
  })
})

describe('mapping', () => {
  it('maps the selection corner to the content corner and back', () => {
    const crop = { x: 400, y: 300, w: 600, h: 400 }
    const layout = computeLayout(big, crop, 2, 1, null, style)
    expect(layout.content.w).toBe(600)
    const corner = sourceToOutput(layout, { x: 400, y: 300 })
    expect(corner).toEqual({ x: layout.content.x, y: layout.content.y })
    expect(outputToSource(layout, corner)).toEqual({ x: 400, y: 300 })
  })

  it('falls back to the whole image for an empty or out-of-range selection', () => {
    const layout = computeLayout({ width: 800, height: 500 }, { x: 900, y: 900, w: 10, h: 10 }, 2, 1, null, style)
    expect(layout.sel).toEqual({ x: 0, y: 0, w: 800, h: 500 })
  })

  it('places new boxes inside what is visible', () => {
    const layout = computeLayout(big, null, 2, 1, null, style)
    const box = centeredBox(layout, 0.5, 0.5)
    const visible = visibleSource(layout)
    expect(box.x).toBeGreaterThanOrEqual(visible.x)
    expect(box.x + box.w).toBeLessThanOrEqual(visible.x + visible.w)
    expect(box.y + box.h).toBeLessThanOrEqual(visible.y + visible.h)
  })
})

describe('cropping', () => {
  const cap = capacity(scaleFor(2, 1, style), style, null)

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
    const at100 = computeLayout(big, open, 2, 1, null, style)
    expect(at100.sel).toEqual({ x: 700, y: 400, w: 1504, h: 904 })
    const at80 = computeLayout(big, open, 2, 0.8, null, style)
    expect(at80.edge).toBe('br') // still running off the edges…
    expect(at80.sel.w).toBeGreaterThan(1504) // …showing more of the screenshot
    expect(at80.content.w).toBeCloseTo(OUTPUT.width - inset)
  })

  it('opens towards the left / top when the frame comes in from there', () => {
    const capL = capacity(scaleFor(2, 1, style), style, 'l')
    const sel = { x: 600, y: 300, w: capL.width, h: 500 }
    const open = openSelection(sel, big, capL, 'l')
    expect(open).toEqual({ x: 0, y: 300, w: 600 + capL.width, h: 500 })
    // At 100% it shows exactly what was selected: the part next to the visible frame edge.
    expect(computeLayout(big, open, 2, 1, 'l', style).sel.x).toBe(600)
  })

  it('leaves axes that stay inside literal', () => {
    const capC = capacity(scaleFor(2, 1, style), style, 'c')
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
  it('lays shots out in a row and finds the one under a point', () => {
    expect(shotRect(0)).toEqual({ x: 0, y: 0, w: 1600, h: 1000 })
    expect(shotRect(2).x).toBe(2 * (1600 + SHOT_GAP))
    expect(shotAt(3, { x: 10, y: 10 })).toBe(0)
    expect(shotAt(3, { x: 1600 + SHOT_GAP + 5, y: 500 })).toBe(1)
    expect(shotAt(3, { x: 1600 + SHOT_GAP / 2, y: 500 })).toBe(-1) // the gap
    expect(shotAt(3, { x: 3 * (1600 + SHOT_GAP) + 10, y: 500 })).toBe(-1) // past the last shot
    expect(shotAt(3, { x: 10, y: -5 })).toBe(-1)
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
    expect(exportFileName('')).toBe('whats-new-shot.webp')
    expect(exportFileName('', 'png', 'whats-new-shot-3')).toBe('whats-new-shot-3.png')
    expect(exportFileName('Edit Storage', 'webp')).toBe('edit-storage.webp')
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
