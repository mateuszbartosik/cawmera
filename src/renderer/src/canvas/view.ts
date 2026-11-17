import { EXPORT_DENSITY } from '../app/house-style'
import { snapDensity } from '../app/doc'
import { FIT_ALL, getSource, liveShots, store, type AppState, type Camera } from '../app/store'
import { getRecording } from '../recording/registry'
import type { Point, Rect, Size } from '../render/geometry'

export const PANEL_WIDTH = 300
export const PANEL_GAP = 10
export const MENU_BUTTON_SIZE = 36
const TOOLBAR_SPACE = 64
/** Height the recording timeline takes at the bottom of the canvas. */
export const TIMELINE_SPACE = 212
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

/** What crop mode crops: the screenshot, or the video of a recording. `density` is the units per CSS px at 100%. */
export function cropSubject(s: Pick<AppState, 'doc'>): (Size & { density: number }) | null {
  const { doc } = s
  if (doc.recording) {
    const track = getRecording(doc.sourceId)?.track
    return track ? { width: track.width, height: track.height, density: snapDensity(track.scale) } : null
  }
  const source = getSource(doc.sourceId)
  return source ? { width: source.width, height: source.height, density: doc.capturedAt } : null
}

export function isNarrow(s: Pick<AppState, 'viewport'>): boolean {
  return s.viewport.width > 0 && s.viewport.width < NARROW_WIDTH
}

/** The least `left` a toast may have so it never covers the menu button. */
export function toastClearance(showsMenuButton: boolean): number {
  return showsMenuButton ? PANEL_GAP * 2 + MENU_BUTTON_SIZE : PANEL_GAP
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

/** World rects of the shots on the shots canvas (export px): a row, top-aligned, each at its own size. */
export function shotRects(sizes: Size[]): Rect[] {
  let x = 0
  return sizes.map(({ width, height }) => {
    const r = { x, y: 0, w: width, h: height }
    x += width + SHOT_GAP
    return r
  })
}

/** The sizes of all shots, the active one live. */
export const shotSizes = (s: AppState): Size[] => liveShots(s).map((record) => record.doc.size)

/** World rect of shot `index` (export px). */
export const shotRect = (s: AppState, index: number): Rect => shotRects(shotSizes(s))[index] ?? { x: 0, y: 0, w: s.doc.size.width, h: s.doc.size.height }

function shotsBounds(rects: Rect[]): Rect {
  const last = rects.at(-1)
  if (!last) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: 0, y: 0, w: last.x + last.w, h: Math.max(...rects.map((r) => r.h)) }
}

/** Where a shot dragged by its name lands: the number of shots whose middle is left of `x`. */
export function slotAt(rects: Rect[], x: number): number {
  return rects.filter((r) => r.x + r.w / 2 < x).length
}

/** World x of the line drawn between shots for a reorder slot. */
export function slotX(rects: Rect[], slot: number): number {
  if (rects.length === 0) return 0
  if (slot < rects.length) return rects[slot].x - SHOT_GAP / 2
  const last = rects[rects.length - 1]
  return last.x + last.w + SHOT_GAP / 2
}

export function activeIndex(s: Pick<AppState, 'shots' | 'activeId'>): number {
  return Math.max(0, s.shots.findIndex((record) => record.id === s.activeId))
}

/** The timeline runs under the canvas of a recording shot, except in the narrow layout. */
export function timelineShows(s: Pick<AppState, 'viewport' | 'doc'>): boolean {
  return !isNarrow(s) && s.doc.recording !== null
}

const BAR_UNDER_TOOLBAR = { top: 56 }
const BAR_ABOVE_TOOLBAR = { bottom: 58 }
const BAR_ABOVE_TIMELINE = { bottom: 58 + TIMELINE_SPACE }

/**
 * The crop and selection bars float above the toolbar, which the timeline lifts when it shows; in the narrow layout they sit under
 * it. Each place is one object, so a component can select it from the store.
 */
export function floatingBarPlace(s: Pick<AppState, 'viewport' | 'doc'>): { top: number } | { bottom: number } {
  if (isNarrow(s)) return BAR_UNDER_TOOLBAR
  return timelineShows(s) ? BAR_ABOVE_TIMELINE : BAR_ABOVE_TOOLBAR
}

/** The timeline edits the take only outside crop mode, where the canvas shows the frame the crop is drawn on. */
export function timelineEditable(s: Pick<AppState, 'viewport' | 'doc' | 'mode'>): boolean {
  return timelineShows(s) && s.mode === 'compose'
}

function areaOf(s: AppState, cropping: boolean) {
  const narrow = isNarrow(s)
  const right = narrow ? 0 : PANEL_WIDTH + PANEL_GAP * 2
  const barSpace = cropping ? CROP_BAR_SPACE : 0
  const top = narrow ? TOOLBAR_SPACE - 8 + barSpace : 0
  const timelineSpace = timelineShows(s) ? TIMELINE_SPACE : 0
  const bottom = narrow ? Math.round(s.viewport.height * SHEET_SHARE) + PANEL_GAP : TOOLBAR_SPACE + barSpace + timelineSpace
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
  const subject = cropSubject(s)
  const target =
    cropping && subject
      ? { x: 0, y: 0, w: subject.width, h: subject.height }
      : camera.fit === 'active'
        ? shotRect(s, activeIndex(s))
        : shotsBounds(shotRects(shotSizes(s)))
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
  const subject = cropSubject(s)
  const cropping = s.mode === 'crop' && subject !== null
  const area = areaOf(s, cropping)
  const density = cropping ? subject.density : EXPORT_DENSITY
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
export function shotAt(sizes: Size[], p: Point): number {
  return shotRects(sizes).findIndex((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)
}

function setCamera(camera: Camera) {
  store.set((s) => (s.mode === 'crop' && cropSubject(s) ? { cropView: camera } : { view: camera }))
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
  const target = shotRect(s, activeIndex(s))
  const r = toScreen(g, target)
  const inside =
    r.left >= g.area.x && r.top - LABEL_SPACE >= g.area.y && r.left + r.width <= g.area.x + g.area.width && r.top + r.height <= g.area.y + g.area.height
  if (inside) return
  const fits = r.width <= g.area.width - 2 * FIT_PADDING_X && r.height + LABEL_SPACE <= g.area.height - 2 * FIT_PADDING_Y
  if (!fits) {
    zoomToActive()
    return
  }
  store.set({ view: { fit: null, zoom: g.zoom, cx: target.x + target.w / 2, cy: target.y + target.h / 2 - LABEL_SPACE / 2 / g.k } })
}
