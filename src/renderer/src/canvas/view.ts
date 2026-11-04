import { OUTPUT } from '../app/house-style'
import { FIT_ALL, getSource, store, type AppState, type Camera } from '../app/store'
import type { Rect } from '../render/geometry'

export const PANEL_WIDTH = 300
export const PANEL_GAP = 10
const TOOLBAR_SPACE = 64
/** The crop bar sits above the toolbar while cropping. */
const CROP_BAR_SPACE = 46
/** Below this width the panel docks to the bottom as a sheet and the toolbar moves to the top. */
export const NARROW_WIDTH = 760
export const SHEET_SHARE = 0.5
/** Export px between two shots on the canvas. */
export const SHOT_GAP = 160
/** Screen px kept free above the shots for their names. */
export const LABEL_SPACE = 26
const FIT_PADDING_X = 56
const FIT_PADDING_Y = 36
export const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8]
const MIN_ZOOM = 0.02
const MAX_ZOOM = 8
const MAX_FIT_ZOOM = 4

export function isNarrow(s: Pick<AppState, 'viewport'>): boolean {
  return s.viewport.width > 0 && s.viewport.width < NARROW_WIDTH
}

export interface WorkspaceGeometry {
  /** Area the content is laid out in (excludes the panel and the toolbar). */
  area: { x: number; y: number; width: number; height: number }
  cropping: boolean
  /** Units per CSS px at 100%: 2 for export px, the capture density for source px. */
  density: number
  /** 1 = 100%: the image as wide as its design width. */
  zoom: number
  /** Screen px per unit. */
  k: number
  /** Screen position of world (0, 0). */
  originX: number
  originY: number
}

/** World rect of shot `index` on the shots canvas (export px). */
export function shotRect(index: number): Rect {
  return { x: index * (OUTPUT.width + SHOT_GAP), y: 0, w: OUTPUT.width, h: OUTPUT.height }
}

function shotsBounds(count: number): Rect {
  const n = Math.max(1, count)
  return { x: 0, y: 0, w: n * OUTPUT.width + (n - 1) * SHOT_GAP, h: OUTPUT.height }
}

export function activeIndex(s: Pick<AppState, 'shots' | 'activeId'>): number {
  return Math.max(0, s.shots.findIndex((record) => record.id === s.activeId))
}

function areaOf(s: AppState, cropping: boolean) {
  const narrow = isNarrow(s)
  const right = narrow ? 0 : PANEL_WIDTH + PANEL_GAP * 2
  const barSpace = cropping ? CROP_BAR_SPACE : 0
  const top = narrow ? TOOLBAR_SPACE - 8 + barSpace : 0
  const bottom = narrow ? Math.round(s.viewport.height * SHEET_SHARE) + PANEL_GAP : TOOLBAR_SPACE + barSpace
  return {
    x: 0,
    y: top,
    width: Math.max(120, s.viewport.width - right),
    height: Math.max(120, s.viewport.height - top - bottom)
  }
}

/** The camera with any fit resolved to a concrete zoom and centre. */
function resolveCamera(s: AppState, cropping: boolean, area: WorkspaceGeometry['area'], density: number) {
  const camera = cropping ? s.cropView : s.view
  if (!camera.fit) return { zoom: camera.zoom, cx: camera.cx, cy: camera.cy }
  const source = getSource(s.doc.sourceId)
  const target = cropping && source ? { x: 0, y: 0, w: source.width, h: source.height } : camera.fit === 'active' ? shotRect(activeIndex(s)) : shotsBounds(s.shots.length)
  const narrow = isNarrow(s)
  const padX = narrow ? 16 : FIT_PADDING_X
  const padY = narrow ? 12 : FIT_PADDING_Y
  const labels = cropping ? 0 : LABEL_SPACE
  const k = Math.min((area.width - padX * 2) / target.w, (area.height - padY * 2 - labels) / target.h)
  const zoom = Math.max(MIN_ZOOM, Math.min(k * density, MAX_FIT_ZOOM))
  const finalK = zoom / density
  // Centre the shots together with the names above them.
  return { zoom, cx: target.x + target.w / 2, cy: target.y + target.h / 2 - labels / 2 / finalK }
}

export function workspaceGeometry(s: AppState): WorkspaceGeometry {
  const source = getSource(s.doc.sourceId)
  const cropping = s.mode === 'crop' && source !== null
  const area = areaOf(s, cropping)
  const density = cropping ? s.doc.capturedAt : OUTPUT.scale
  const camera = resolveCamera(s, cropping, area, density)
  const k = camera.zoom / density
  return {
    area,
    cropping,
    density,
    zoom: camera.zoom,
    k,
    originX: area.x + area.width / 2 - camera.cx * k,
    originY: area.y + area.height / 2 - camera.cy * k
  }
}

/** Screen rect (CSS px, relative to the workspace) of a world rect. */
export function toScreen(g: WorkspaceGeometry, r: Rect) {
  return { left: g.originX + r.x * g.k, top: g.originY + r.y * g.k, width: r.w * g.k, height: r.h * g.k }
}

/** World point under a workspace-relative screen point. */
export function toWorld(g: WorkspaceGeometry, x: number, y: number) {
  return { x: (x - g.originX) / g.k, y: (y - g.originY) / g.k }
}

/** Index of the shot under a world point, or -1. */
export function shotAt(count: number, p: { x: number; y: number }): number {
  if (p.y < 0 || p.y > OUTPUT.height || p.x < 0) return -1
  const index = Math.floor(p.x / (OUTPUT.width + SHOT_GAP))
  const local = p.x - index * (OUTPUT.width + SHOT_GAP)
  return index < count && local <= OUTPUT.width ? index : -1
}

function setCamera(camera: Camera) {
  store.set((s) => (s.mode === 'crop' && getSource(s.doc.sourceId) ? { cropView: camera } : { view: camera }))
}

/** Zooms so the world point under `anchor` (workspace px) stays put. */
export function zoomTo(nextZoom: number, anchor?: { x: number; y: number }) {
  const g = workspaceGeometry(store.get())
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom))
  const centerX = g.area.x + g.area.width / 2
  const centerY = g.area.y + g.area.height / 2
  const ax = anchor?.x ?? centerX
  const ay = anchor?.y ?? centerY
  const world = toWorld(g, ax, ay)
  const k = zoom / g.density
  setCamera({ fit: null, zoom, cx: world.x - (ax - centerX) / k, cy: world.y - (ay - centerY) / k })
}

export function zoomStep(direction: 1 | -1) {
  const current = workspaceGeometry(store.get()).zoom
  const next =
    direction > 0
      ? (ZOOM_STEPS.find((step) => step > current + 1e-3) ?? ZOOM_STEPS.at(-1)!)
      : ([...ZOOM_STEPS].reverse().find((step) => step < current - 1e-3) ?? ZOOM_STEPS[0])
  zoomTo(next)
}

/** Shift+1: every shot (or the whole screenshot while cropping). */
export function zoomFit() {
  setCamera({ ...FIT_ALL })
}

/** Shift+2: the active shot. */
export function zoomToActive() {
  if (store.get().mode === 'crop') return zoomFit()
  setCamera({ fit: 'active', zoom: 1, cx: 0, cy: 0 })
}

export function panBy(dx: number, dy: number) {
  const g = workspaceGeometry(store.get())
  const centerX = g.area.x + g.area.width / 2
  const centerY = g.area.y + g.area.height / 2
  const cx = (centerX - g.originX) / g.k
  const cy = (centerY - g.originY) / g.k
  setCamera({ fit: null, zoom: g.zoom, cx: cx - dx / g.k, cy: cy - dy / g.k })
}

/** Brings the active shot into view: pans if it fits at this zoom, zooms to it otherwise. */
export function revealActive() {
  const s = store.get()
  if (s.mode === 'crop' || s.view.fit === 'all') return
  const g = workspaceGeometry(s)
  const r = toScreen(g, shotRect(activeIndex(s)))
  const inside =
    r.left >= g.area.x && r.top - LABEL_SPACE >= g.area.y && r.left + r.width <= g.area.x + g.area.width && r.top + r.height <= g.area.y + g.area.height
  if (inside) return
  const fits = r.width <= g.area.width - 2 * FIT_PADDING_X && r.height + LABEL_SPACE <= g.area.height - 2 * FIT_PADDING_Y
  if (!fits) {
    zoomToActive()
    return
  }
  const target = shotRect(activeIndex(s))
  store.set({ view: { fit: null, zoom: g.zoom, cx: target.x + target.w / 2, cy: target.y + target.h / 2 - LABEL_SPACE / 2 / g.k } })
}
