import { memo, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { ImageSquare, Trash, X } from '@phosphor-icons/react'
import type { HouseStyle } from '../app/house-style'
import type { Doc } from '../app/doc'
import { deleteShot, enterCrop, leaveCrop, removeSelected, shotFileName } from '../app/actions'
import {
  boxKey,
  clearPickedShots,
  getSource,
  hasBox,
  isUnsaved,
  moveShot,
  newId,
  pickShotsInArea,
  selectLiveShots,
  selectShot,
  store,
  toggleShotPicked,
  updateDoc,
  useApp,
  type BoxRef,
  type ShotRecord
} from '../app/store'
import { drawRecordingFrame } from '../recording/frame'
import { togglePlayback } from '../recording/playback'
import { stepSpaceTap } from './space-tap'
import { recordingScene } from '../recording/scene'
import { POSTER_OUTPUT_MS, useRecording } from '../recording/registry'
import type { TakeView } from '../recording/take-view'
import { aimZoomByHand } from '../recording/zoom-actions'
import { areaGrabAt, draggedFraming, type AreaGrab } from '../recording/zoom-area'
import { useDragSession } from '../timeline/drag-session'
import { drawScene } from '../render/compose'
import {
  clipTo,
  confineMove,
  contains,
  HANDLE_CURSOR,
  handlePoint,
  HANDLES,
  normalize,
  rect,
  resizeRect,
  type Handle,
  type Point,
  type Rect
} from '../render/geometry'
import {
  capacity,
  computeLayout,
  drawnSelection,
  effectiveSelection,
  moveSelection,
  openSelection,
  resizeSelection,
  resolveEdge,
  scaleFor,
  settleSelection,
  sourceRectToOutput,
  type Layout,
  type Size
} from '../render/layout'
import { cn } from '../ui/controls'
import { activeIndex, panBy, shotAt, shotRects, slotAt, slotX, toScreen, toWorld, workspaceGeometry, zoomTo, type WorkspaceGeometry } from './view'
import { RecordingCanvas, sizeCanvas } from './RecordingCanvas'
import { useZoomArea, ZoomAreaMarks } from './ZoomAreaMarks'

const HANDLE_PX = 8
const MIN_ITEM = 6
const MIN_CROP = 24
/** Pointer travel before a press on a shot name becomes a reorder, or a press on a zoom’s area moves it. */
const DRAG_THRESHOLD = 4

type Drag =
  | { kind: 'view-pan'; x: number; y: number; moved: boolean }
  | { kind: 'item-move'; targets: BoxRef[]; start: Point; rects: Rect[] }
  | { kind: 'item-resize'; target: BoxRef; handle: Handle; start: Point; rect: Rect }
  /** A box drawn on the empty canvas (screen px in the workspace) picks the shots it touches. */
  | { kind: 'marquee'; start: Point; additive: boolean; moved: boolean; hits: string[] }
  | { kind: 'redaction-draw'; id: string | null; start: Point }
  | { kind: 'sel-move'; start: Point; rect: Rect }
  | { kind: 'sel-resize'; handle: Handle; start: Point; rect: Rect }
  | { kind: 'sel-draw'; start: Point; before: Doc }
  /** The zoom it aims is pinned when the drag starts; `area` is in frame px, `scale` in export px per frame px. */
  | { kind: 'zoom-area'; id: string; grab: AreaGrab; start: Point; area: Rect; take: Pick<TakeView, 'crop' | 'frame'>; scale: number; moved: boolean }

/** A drag that edits the shot, as one undo step. */
type EditDrag = Exclude<Drag, { kind: 'view-pan' | 'marquee' }>
const isEditDrag = (drag: Drag): drag is EditDrag => drag.kind !== 'view-pan' && drag.kind !== 'marquee'

interface Item {
  box: BoxRef
  /** Export px, in the shot. */
  out: Rect
  /** Source px. */
  src: Rect
}

function itemsFor(doc: Doc, layout: Layout): Item[] {
  const items: Item[] = []
  for (const r of [...doc.redactions].reverse()) {
    items.push({ box: { kind: 'redaction', id: r.id }, out: sourceRectToOutput(layout, r.rect), src: r.rect })
  }
  if (doc.spotlight.on && doc.spotlight.rect) {
    items.push({ box: { kind: 'spotlight' }, out: sourceRectToOutput(layout, doc.spotlight.rect), src: doc.spotlight.rect })
  }
  return items
}

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return rect(x, y, Math.max(a.x + a.w, b.x + b.w) - x, Math.max(a.y + a.h, b.y + b.h) - y)
}
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

function hitHandle(r: Rect, p: Point, tolerance: number): Handle | null {
  for (const handle of HANDLES) {
    const hp = handlePoint(r, handle)
    if (Math.abs(hp.x - p.x) <= tolerance && Math.abs(hp.y - p.y) <= tolerance) return handle
  }
  return null
}

function setItemRect(target: BoxRef, next: Rect) {
  setItemRects([target], [next])
}

/** Moves or resizes boxes together, as one change (no history: drags commit when they end). */
function setItemRects(targets: BoxRef[], rects: Rect[]) {
  const byKey = new Map(targets.map((target, i) => [boxKey(target), rects[i]]))
  const spotlight = byKey.get('spotlight')
  updateDoc(
    (d) => ({
      redactions: d.redactions.map((r) => (byKey.has(r.id) ? { ...r, rect: byKey.get(r.id)! } : r)),
      spotlight: spotlight ? { ...d.spotlight, rect: spotlight } : d.spotlight
    }),
    { history: false }
  )
}

/** What fits for the document's current scale and edge (source px). */
function capFor(doc: Doc): Size {
  const style = store.get().style
  const scale = scaleFor(doc.capturedAt, doc.zoom, style)
  return capacity(scale, style, doc.edge ?? null, doc.size)
}

/** The selection crop mode shows: what the frame actually shows. */
function selectionFor(doc: Doc): Rect | null {
  const source = getSource(doc.sourceId)
  if (!source) return null
  const style = store.get().style
  const scale = scaleFor(doc.capturedAt, doc.zoom, style)
  const edge = resolveEdge(doc.edge, doc.crop, source, scale, style, doc.size)
  return effectiveSelection(doc.crop, source, capacity(scale, style, edge, doc.size), edge)
}

/** Dot grid that moves and scales with the canvas, like a design tool's. */
function dotBackground(g: WorkspaceGeometry) {
  let pitch = 24 * g.zoom
  while (pitch < 14) pitch *= 2
  while (pitch > 40) pitch /= 2
  const mod = (value: number) => ((value % pitch) + pitch) % pitch
  return {
    backgroundImage: 'radial-gradient(circle, var(--tc-dot) 1px, transparent 1.4px)',
    backgroundSize: `${pitch}px ${pitch}px`,
    backgroundPosition: `${mod(g.originX) - pitch / 2}px ${mod(g.originY) - pitch / 2}px`
  }
}

// ---------------------------------------------------------------------------
// One shot, drawn with the same renderer as the export.

const ShotCanvas = memo(function ShotCanvas({
  doc,
  style,
  backdrop,
  box,
  active,
  outlined,
  faded
}: {
  doc: Doc
  style: HouseStyle
  backdrop: ImageBitmap | null
  box: { left: number; top: number; width: number; height: number }
  active: boolean
  outlined: boolean
  faded: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const backingWidth = Math.max(1, Math.min(4096, Math.round(box.width * dpr)))
  const entry = useRecording(doc.sourceId)
  const recording = doc.recording ? entry : null
  const live = recording !== null && active
  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    sizeCanvas(canvas, doc.size, backingWidth)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, backingWidth, canvas.height)
    if (recording) {
      const scene = recording.poster && recordingScene(recording, doc, style, backdrop, recording.poster)
      if (scene) drawRecordingFrame(ctx, scene, POSTER_OUTPUT_MS, 'preview', backingWidth / doc.size.width)
      return
    }
    const source = getSource(doc.sourceId)
    const scene = { source: source ? { image: source.bitmap, width: source.width, height: source.height } : null, doc, style, backdrop }
    drawScene(ctx, scene, backingWidth / doc.size.width)
  }, [doc, style, backdrop, backingWidth, recording, live])
  const empty = doc.sourceId === null
  const canvasProps = {
    'data-testid': 'shot-canvas',
    'data-active': active || undefined,
    'aria-label': empty ? 'Empty shot' : recording ? 'Framed recording' : 'Framed screenshot',
    className: 'block size-full',
    style: { boxShadow: outlined ? '0 0 0 1.5px var(--tc-accent)' : '0 0 0 1px var(--tc-artboard-edge)' }
  }
  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height, opacity: faded ? 0.45 : 1 }}
    >
      {live ? (
        <RecordingCanvas doc={doc} style={style} backdrop={backdrop} backingWidth={backingWidth} canvasProps={canvasProps} />
      ) : (
        <canvas ref={ref} {...canvasProps} />
      )}
      {empty && box.width > 60 && (
        <span className="absolute inset-0 grid place-items-center text-white/40" aria-hidden>
          <ImageSquare size={Math.max(16, Math.min(40, box.width / 18))} />
        </span>
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------

export function Workspace() {
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const spaceRef = useRef(false)
  const spaceTapRef = useRef(false)
  const [hover, setHover] = useState<{ cursor: string; item: string | null }>({ cursor: 'default', item: null })
  const [dragging, setDragging] = useState(false)
  const [reorder, setReorder] = useState<{ id: string; from: number; slot: number; active: boolean } | null>(null)
  /** The box being drawn on the empty canvas (workspace px) and the shots it would pick. */
  const [marquee, setMarquee] = useState<{ area: Rect; ids: string[] } | null>(null)
  const editDrag = useDragSession()

  const state = useApp((s) => s)
  const shots = selectLiveShots(state)
  const sizes = shots.map((record) => record.doc.size)
  const rects = shotRects(sizes)
  const { doc, mode, selection, style } = state
  const backdrop = state.backdrop?.bitmap ?? null
  const source = getSource(doc.sourceId)
  const g = workspaceGeometry(state)
  const active = activeIndex(state)
  const layout = source ? computeLayout(source, doc.crop, doc.capturedAt, doc.zoom, doc.edge, style, doc.size) : null
  const cropping = g.cropping && source !== null
  const activeBox = toScreen(g, rects[active])

  const zoomArea = useZoomArea(doc, style, state.timelineSelection, state.playback.time)
  const shownZoomId = zoomArea?.zoom.id ?? null

  const endEditDrag = () => {
    editDrag.end()
    const drag = dragRef.current
    if (!drag || !isEditDrag(drag)) return
    dragRef.current = null
    setDragging(false)
  }

  // The selection going away (Escape, Delete, Undo, playback) ends an area drag before another pointer move can edit.
  useLayoutEffect(() => {
    const drag = dragRef.current
    if (drag?.kind === 'zoom-area' && drag.id !== shownZoomId) endEditDrag()
  }, [shownZoomId])

  // Track the viewport size.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver(() => {
      store.set({ viewport: { width: root.clientWidth, height: root.clientHeight } })
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  // Wheel: pan, or zoom with Ctrl / Cmd (and trackpad pinch, which arrives as Ctrl+wheel).
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const bounds = root.getBoundingClientRect()
        const current = workspaceGeometry(store.get()).zoom
        zoomTo(current * Math.exp(-event.deltaY * 0.0022), { x: event.clientX - bounds.left, y: event.clientY - bounds.top })
      } else {
        panBy(-event.deltaX, -event.deltaY)
      }
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [])

  // Space + drag pans the view, like every design tool.
  useEffect(() => {
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
    const modified = (event: KeyboardEvent) => event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !typing(event.target)) {
        spaceRef.current = true
        if (!event.repeat) setHover((h) => ({ ...h, cursor: 'grab' }))
        spaceTapRef.current = stepSpaceTap(spaceTapRef.current, {
          kind: 'down',
          repeat: event.repeat,
          typing: false,
          modified: modified(event)
        }).armed
        event.preventDefault()
      }
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        const { doc, mode } = store.get()
        const step = stepSpaceTap(spaceTapRef.current, {
          kind: 'up',
          typing: typing(event.target),
          modified: modified(event),
          playable: doc.recording !== null && mode === 'compose'
        })
        spaceRef.current = false
        spaceTapRef.current = step.armed
        setHover((h) => ({ ...h, cursor: 'default' }))
        if (step.toggle) togglePlayback()
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const bounds = rootRef.current!.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }
  /** World point: source px while cropping, export px on the shots canvas. */
  const worldPoint = (event: { clientX: number; clientY: number }) => {
    const p = localPoint(event)
    return toWorld(g, p.x, p.y)
  }
  /** Export px inside the active shot. */
  const inActive = (p: Point): Point => ({ x: p.x - rects[active].x, y: p.y })
  const unitsPerPx = 1 / g.k
  const tolerance = (HANDLE_PX / 2 + 4) * unitsPerPx

  // -------------------------------------------------------------------------
  // Pointer

  const startViewPan = (event: ReactPointerEvent) => {
    dragRef.current = { kind: 'view-pan', x: event.clientX, y: event.clientY, moved: false }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button === 2) return
    const root = rootRef.current!
    const world = worldPoint(event)
    const s = store.get()
    editDrag.end()
    dragRef.current = null

    if (event.button === 1 || spaceRef.current) {
      spaceTapRef.current = stepSpaceTap(spaceTapRef.current, { kind: 'panStarted' }).armed
      startViewPan(event)
    } else if (cropping && source) {
      const p = world
      const full = rect(0, 0, source.width, source.height)
      const sel = selectionFor(s.doc)!
      const handle = hitHandle(sel, p, tolerance)
      const movable = sel.w < source.width - 0.5 || sel.h < source.height - 0.5
      if (handle) dragRef.current = { kind: 'sel-resize', handle, start: p, rect: sel }
      else if (movable && contains(sel, p)) dragRef.current = { kind: 'sel-move', start: p, rect: sel }
      else if (contains(full, p)) dragRef.current = { kind: 'sel-draw', start: p, before: s.doc }
      else startViewPan(event)
    } else {
      const index = shotAt(sizes, world)
      // Shift or Ctrl / Cmd adds to a selection (boxes, or shots), like a design tool.
      const multi = event.shiftKey || event.ctrlKey || event.metaKey
      const areaGrab = zoomArea && !multi ? areaGrabAt(zoomArea.out, inActive(world), tolerance) : null
      if (zoomArea && areaGrab) {
        clearPickedShots()
        const { zoom, area, take, scale } = zoomArea
        dragRef.current = { kind: 'zoom-area', id: zoom.id, grab: areaGrab, start: inActive(world), area, take, scale, moved: false }
      } else if (index === active && layout) {
        const p = inActive(world)
        const items = itemsFor(s.doc, layout)
        const chosen = items.filter((item) => hasBox(s.selection, item.box))
        const single = chosen.length === 1 ? chosen[0] : null
        const handle = single && !multi ? hitHandle(single.out, p, tolerance) : null
        const hit = items.find((item) => contains(item.out, p))
        if (single && handle) {
          clearPickedShots()
          dragRef.current = { kind: 'item-resize', target: single.box, handle, start: p, rect: single.src }
        } else if (event.altKey && contains(layout.content, p)) {
          store.set({ selection: [], shotSelection: [] })
          dragRef.current = { kind: 'redaction-draw', id: null, start: p }
        } else if (hit && multi) {
          const key = boxKey(hit.box)
          const selection = hasBox(s.selection, hit.box) ? s.selection.filter((box) => boxKey(box) !== key) : [...s.selection, hit.box]
          store.set({ selection, shotSelection: [] })
        } else if (hit) {
          // Dragging one of several selected boxes moves them all.
          const group = hasBox(s.selection, hit.box) && chosen.length > 1 ? chosen : [hit]
          store.set({ selection: group.map((item) => item.box), shotSelection: [] })
          dragRef.current = { kind: 'item-move', targets: group.map((item) => item.box), start: p, rects: group.map((item) => item.src) }
        } else if (multi) {
          toggleShotPicked(s.activeId)
        } else {
          // The screenshot itself never moves inside its shot; a drag here moves the canvas.
          store.set({ selection: [], shotSelection: [] })
          startViewPan(event)
        }
      } else if (index >= 0) {
        if (multi) {
          toggleShotPicked(shots[index].id)
        } else {
          selectShot(shots[index].id)
          store.set({ selection: [] })
          startViewPan(event)
        }
      } else if (event.pointerType === 'touch') {
        startViewPan(event)
      } else {
        // Empty canvas: a box drawn here picks the shots it touches.
        if (!multi) store.set({ selection: [] })
        dragRef.current = { kind: 'marquee', start: localPoint(event), additive: multi, moved: false, hits: [] }
      }
    }

    // Read back through a cast: startViewPan() also sets it, which TypeScript can't follow.
    const started = dragRef.current as Drag | null
    if (started) {
      root.setPointerCapture(event.pointerId)
      if (started.kind !== 'view-pan') setDragging(true)
      if (isEditDrag(started)) editDrag.begin()
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const world = worldPoint(event)
    if (!drag) {
      updateHover(world)
      return
    }
    if (drag.kind === 'view-pan') {
      if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 2) return
      if (!drag.moved) setHover((h) => ({ ...h, cursor: 'grabbing' }))
      drag.moved = true
      panBy(event.clientX - drag.x, event.clientY - drag.y)
      drag.x = event.clientX
      drag.y = event.clientY
      return
    }
    if (drag.kind === 'marquee') {
      const local = localPoint(event)
      if (!drag.moved && Math.hypot(local.x - drag.start.x, local.y - drag.start.y) < 3) return
      drag.moved = true
      const area = normalize(rect(drag.start.x, drag.start.y, local.x - drag.start.x, local.y - drag.start.y))
      const a = toWorld(g, area.x, area.y)
      const b = toWorld(g, area.x + area.w, area.y + area.h)
      const touched = rect(a.x, a.y, b.x - a.x, b.y - a.y)
      drag.hits = shots.filter((_, i) => overlaps(touched, rects[i])).map((record) => record.id)
      const base = drag.additive ? (store.get().shotSelection.length > 0 ? store.get().shotSelection : [store.get().activeId]) : []
      setMarquee({ area, ids: [...new Set([...base, ...drag.hits])] })
      return
    }
    if (!editDrag.accepts(event.buttons)) {
      endEditDrag()
      return
    }
    if (drag.kind === 'zoom-area') {
      const p = inActive(world)
      const dx = p.x - drag.start.x
      const dy = p.y - drag.start.y
      if (!drag.moved && Math.hypot(dx, dy) * g.k < DRAG_THRESHOLD) return
      drag.moved = true
      drag.id = aimZoomByHand(drag.id, draggedFraming(drag.area, drag.grab, dx / drag.scale, dy / drag.scale, drag.take), false)
      return
    }
    const s = store.get()
    const src = getSource(s.doc.sourceId)
    if (!src) return
    const full = rect(0, 0, src.width, src.height)

    switch (drag.kind) {
      case 'sel-move': {
        const next = moveSelection(drag.rect, src, world.x - drag.start.x, world.y - drag.start.y)
        updateDoc({ crop: settleSelection(openSelection(next, src, capFor(s.doc), s.doc.edge), src) }, { history: false })
        break
      }
      case 'sel-resize': {
        const cap = capFor(s.doc)
        const next = resizeSelection(drag.rect, drag.handle, world.x - drag.start.x, world.y - drag.start.y, src, cap, MIN_CROP)
        updateDoc({ crop: settleSelection(openSelection(next, src, cap, s.doc.edge), src) }, { history: false })
        break
      }
      case 'sel-draw': {
        const drawn = normalize(rect(drag.start.x, drag.start.y, world.x - drag.start.x, world.y - drag.start.y))
        if (drawn.w >= 4 && drawn.h >= 4) {
          const cap = capFor(s.doc)
          const next = openSelection(drawnSelection(drag.start, world, src, cap), src, cap, s.doc.edge)
          updateDoc({ crop: settleSelection(next, src) }, { history: false })
        }
        break
      }
      case 'item-move': {
        if (!layout) break
        const p = inActive(world)
        // Move the group as one, keeping all of it on the screenshot.
        const bounds = drag.rects.reduce(union)
        const moved = confineMove({ ...bounds, x: bounds.x + (p.x - drag.start.x) / layout.scale, y: bounds.y + (p.y - drag.start.y) / layout.scale }, full)
        const dx = moved.x - bounds.x
        const dy = moved.y - bounds.y
        setItemRects(drag.targets, drag.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })))
        break
      }
      case 'item-resize': {
        if (!layout) break
        const p = inActive(world)
        const sdx = (p.x - drag.start.x) / layout.scale
        const sdy = (p.y - drag.start.y) / layout.scale
        setItemRect(drag.target, clipTo(resizeRect(drag.rect, drag.handle, sdx, sdy, MIN_ITEM), full))
        break
      }
      case 'redaction-draw': {
        if (!layout) break
        const p = inActive(world)
        const a = drag.start
        if (!drag.id && Math.hypot(p.x - a.x, p.y - a.y) < 4 * unitsPerPx) break
        const box = clipTo(
          normalize(
            rect(
              layout.sel.x + (a.x - layout.content.x) / layout.scale,
              layout.sel.y + (a.y - layout.content.y) / layout.scale,
              (p.x - a.x) / layout.scale,
              (p.y - a.y) / layout.scale
            )
          ),
          full
        )
        if (!drag.id) {
          const id = newId()
          drag.id = id
          updateDoc((d) => ({ redactions: [...d.redactions, { id, rect: box }] }), { history: false })
          store.set({ selection: [{ kind: 'redaction', id }] })
        } else {
          setItemRect({ kind: 'redaction', id: drag.id }, box)
        }
        break
      }
    }
  }

  /** A crop or a blur box drawn too small to keep leaves the shot as it was; anything else is one undo step. */
  const finishEditDrag = (drag: EditDrag) => {
    if (!editDrag.isOpen) {
      editDrag.end()
      return
    }
    const s = store.get()
    if (drag.kind === 'sel-draw') {
      const sel = selectionFor(s.doc)
      // A click (or tiny drag) doesn't replace the selection.
      if (!sel || s.doc.crop === drag.before.crop || sel.w < MIN_CROP || sel.h < MIN_CROP) return editDrag.cancel()
    }
    if (drag.kind === 'redaction-draw' && drag.id) {
      const box = s.doc.redactions.find((r) => r.id === drag.id)
      if (box && (box.rect.w < MIN_ITEM || box.rect.h < MIN_ITEM)) return editDrag.cancel()
    }
    editDrag.end()
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    setDragging(false)
    rootRef.current?.releasePointerCapture?.(event.pointerId)
    if (!drag) return
    if (drag.kind === 'view-pan') {
      setHover((h) => ({ ...h, cursor: spaceRef.current ? 'grab' : 'default' }))
      return
    }
    if (drag.kind === 'marquee') {
      setMarquee(null)
      if (drag.moved) pickShotsInArea(drag.hits, drag.additive)
      else if (!drag.additive) clearPickedShots()
      return
    }
    finishEditDrag(drag)
  }

  const onLostPointerCapture = () => {
    const drag = dragRef.current
    if (!drag || !isEditDrag(drag)) return
    dragRef.current = null
    setDragging(false)
    finishEditDrag(drag)
  }

  const updateHover = (world: Point) => {
    if (spaceRef.current) return
    let cursor = 'default'
    let item: string | null = null
    if (cropping && source) {
      const sel = selectionFor(store.get().doc)!
      const handle = hitHandle(sel, world, tolerance)
      const movable = sel.w < source.width - 0.5 || sel.h < source.height - 0.5
      if (handle) cursor = HANDLE_CURSOR[handle]
      else if (movable && contains(sel, world)) cursor = 'move'
      else if (contains(rect(0, 0, source.width, source.height), world)) cursor = 'crosshair'
    } else if (layout && shotAt(sizes, world) === active) {
      const p = inActive(world)
      const s = store.get()
      const items = itemsFor(s.doc, layout)
      const chosen = items.filter((candidate) => hasBox(s.selection, candidate.box))
      const handle = chosen.length === 1 ? hitHandle(chosen[0].out, p, tolerance) : null
      const hit = items.find((candidate) => contains(candidate.out, p))
      if (handle) cursor = HANDLE_CURSOR[handle]
      else if (hit) {
        cursor = 'move'
        item = boxKey(hit.box)
      }
    } else if (zoomArea) {
      const grab = areaGrabAt(zoomArea.out, inActive(world), tolerance)
      if (grab) cursor = grab === 'move' ? 'move' : HANDLE_CURSOR[grab]
    }
    if (cursor !== hover.cursor || item !== hover.item) setHover({ cursor, item })
  }

  const onDoubleClick = (event: ReactMouseEvent) => {
    if (cropping) return leaveCrop()
    if (!layout) return
    const world = worldPoint(event)
    if (shotAt(sizes, world) === active && contains(layout.content, inActive(world))) enterCrop()
  }

  // -------------------------------------------------------------------------
  // Shot names: click to activate, drag to reorder.

  const labelDrag = useRef<{ id: string; from: number; x: number; y: number; pointer: number } | null>(null)

  const onLabelPointerDown = (event: ReactPointerEvent<HTMLDivElement>, record: ShotRecord, index: number) => {
    if (event.button !== 0) return
    event.stopPropagation()
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      toggleShotPicked(record.id)
      return
    }
    selectShot(record.id)
    labelDrag.current = { id: record.id, from: index, x: event.clientX, y: event.clientY, pointer: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onLabelPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = labelDrag.current
    if (!drag) return
    if (!reorder && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD) return
    const slot = slotAt(rects, worldPoint(event).x)
    setReorder({ id: drag.id, from: drag.from, slot, active: true })
  }

  const onLabelPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = labelDrag.current
    labelDrag.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (drag && reorder) {
      const to = reorder.slot > drag.from ? reorder.slot - 1 : reorder.slot
      if (to !== drag.from) moveShot(drag.id, to)
    }
    setReorder(null)
  }

  // -------------------------------------------------------------------------
  // Editor overlays (never exported)

  const handlesFor = (r: Rect, unit: number, fill: string, stroke: string) => {
    const size = HANDLE_PX * unit
    return HANDLES.map((handle) => {
      const hp = handlePoint(r, handle)
      return (
        <rect
          key={handle}
          x={hp.x - size / 2}
          y={hp.y - size / 2}
          width={size}
          height={size}
          rx={1.5 * unit}
          fill={fill}
          stroke={stroke}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )
    })
  }

  let content: ReactNode
  if (cropping && source) {
    const box = toScreen(g, rect(0, 0, source.width, source.height))
    const sel = selectionFor(doc)!
    content = (
      <>
        <CropImage bitmap={source.bitmap} box={box} />
        <svg
          className="pointer-events-none absolute overflow-visible"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          viewBox={`0 0 ${source.width} ${source.height}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          <path
            d={`M0 0H${source.width}V${source.height}H0Z M${sel.x} ${sel.y}v${sel.h}h${sel.w}v${-sel.h}Z`}
            fill="rgba(0,0,0,0.6)"
            fillRule="evenodd"
          />
          <rect x={sel.x} y={sel.y} width={sel.w} height={sel.h} fill="none" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          {handlesFor(sel, unitsPerPx, '#fff', 'rgba(0,0,0,0.6)')}
        </svg>
      </>
    )
  } else {
    const items = layout ? itemsFor(doc, layout) : []
    const chosenItems = items.filter((item) => hasBox(selection, item.box))
    const chosenBounds = chosenItems.length > 0 ? chosenItems.map((item) => item.out).reduce(union) : null
    const deleteAt =
      chosenBounds && !dragging
        ? { left: activeBox.left + (chosenBounds.x + chosenBounds.w) * g.k + 6, top: activeBox.top + chosenBounds.y * g.k - 30 }
        : null
    const deleteLabel =
      chosenItems.length > 1 ? `Delete ${chosenItems.length} boxes` : chosenItems[0]?.box.kind === 'spotlight' ? 'Remove spotlight' : 'Delete blur box'
    // Outlined shots: the picked ones (or what the box being drawn would pick); otherwise the active one.
    const picked = new Set(marquee ? marquee.ids : state.shotSelection)
    const highlighted = (id: string, index: number) => (marquee || picked.size > 0 ? picked.has(id) : shots.length > 1 && index === active)
    const slotLeft = reorder ? g.originX + slotX(rects, reorder.slot) * g.k : 0
    const tallest = Math.max(...rects.map((r) => r.h)) * g.k

    content = (
      <>
        {shots.map((record, index) => (
          <ShotCanvas
            key={record.id}
            doc={record.doc}
            style={style}
            backdrop={backdrop}
            box={toScreen(g, rects[index])}
            active={index === active}
            outlined={highlighted(record.id, index)}
            faded={reorder?.id === record.id}
          />
        ))}

        {shots.map((record, index) => {
          const box = toScreen(g, rects[index])
          const isActive = index === active
          const isPicked = state.shotSelection.includes(record.id)
          const unsaved = isUnsaved(record)
          const empty = record.doc.sourceId === null
          return (
            <div
              key={record.id}
              role="button"
              tabIndex={-1}
              data-testid="shot-label"
              data-shot={record.id}
              data-picked={isPicked || undefined}
              aria-label={`${empty ? 'Empty shot' : shotFileName(record, index)}${isActive ? ', active' : ''}${isPicked ? ', selected' : ''}`}
              className={cn(
                'group absolute flex h-5 items-center gap-1.5 text-[11px] leading-4 select-none',
                (marquee || picked.size > 0 ? picked.has(record.id) : isActive) ? 'text-(--tc-accent)' : 'text-(--tc-label) hover:text-(--tc-fg)'
              )}
              style={{ left: box.left, top: box.top - 24, width: Math.max(box.width, 40), cursor: reorder ? 'grabbing' : 'default' }}
              onPointerDown={(event) => onLabelPointerDown(event, record, index)}
              onPointerMove={onLabelPointerMove}
              onPointerUp={onLabelPointerUp}
              onPointerCancel={onLabelPointerUp}
            >
              <span className="min-w-0 truncate font-medium">{empty ? 'Empty shot' : shotFileName(record, index)}</span>
              {unsaved && <span className="size-1.5 shrink-0 rounded-full bg-(--tc-accent)" title="Not exported yet" aria-label="not exported" />}
              {box.width > 150 && (
                <span className="shrink-0 text-(--tc-value) tabular-nums" data-testid="shot-size">
                  {record.doc.size.width} × {record.doc.size.height}
                </span>
              )}
              <span className="flex-1" />
              {box.width > 90 && !(empty && shots.length === 1) && (
                <button
                  type="button"
                  aria-label="Delete shot"
                  title="Delete shot"
                  data-testid="delete-shot"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    deleteShot(record.id)
                  }}
                  className={cn(
                    'grid size-5 shrink-0 place-items-center rounded-md text-(--tc-label) transition-opacity hover:bg-(--tc-control) hover:text-(--tc-fg)',
                    isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                  )}
                >
                  <X size={11} weight="bold" />
                </button>
              )}
            </div>
          )
        })}

        {reorder && (
          <span
            className="pointer-events-none absolute w-0.5 rounded-full bg-(--tc-accent)"
            style={{ left: slotLeft - 1, top: activeBox.top - 24, height: tallest + 24 }}
            aria-hidden
          />
        )}

        {layout && (
          <svg
            className="pointer-events-none absolute overflow-visible"
            style={{ left: activeBox.left, top: activeBox.top, width: activeBox.width, height: activeBox.height }}
            viewBox={`0 0 ${doc.size.width} ${doc.size.height}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            {chosenItems.length > 1 && chosenBounds && (
              <rect
                x={chosenBounds.x}
                y={chosenBounds.y}
                width={chosenBounds.w}
                height={chosenBounds.h}
                fill="none"
                stroke="var(--tc-accent)"
                strokeWidth={1}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
                data-testid="box-group"
              />
            )}
            {items.map((item) => {
              const key = boxKey(item.box)
              if (hasBox(selection, item.box)) {
                return (
                  <g key={key} data-testid="selected-box">
                    <rect x={item.out.x} y={item.out.y} width={item.out.w} height={item.out.h} fill="none" stroke="var(--tc-accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                    {chosenItems.length === 1 && handlesFor(item.out, unitsPerPx, '#fff', 'var(--tc-accent)')}
                  </g>
                )
              }
              if (hover.item === key) {
                return (
                  <rect key={key} x={item.out.x} y={item.out.y} width={item.out.w} height={item.out.h} fill="none" stroke="var(--tc-accent)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
                )
              }
              return null
            })}
          </svg>
        )}

        {zoomArea && <ZoomAreaMarks shown={zoomArea} box={activeBox} size={doc.size} k={g.k} />}

        {deleteAt && (
          <button
            type="button"
            data-testid="delete-box"
            aria-label={deleteLabel}
            title={`${deleteLabel} (Delete)`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              removeSelected()
            }}
            className="absolute grid size-6 place-items-center rounded-md border border-(--tc-line) bg-(--tc-panel-solid) text-(--tc-fg) shadow-[var(--tc-panel-shadow)] hover:bg-(--tc-control-hover)"
            style={{ left: deleteAt.left, top: deleteAt.top }}
          >
            <Trash size={13} />
          </button>
        )}

        {marquee && (
          <div
            data-testid="marquee"
            className="pointer-events-none absolute rounded-[2px] border border-(--tc-accent) bg-(--tc-accent)/10"
            style={{ left: marquee.area.x, top: marquee.area.y, width: marquee.area.w, height: marquee.area.h }}
            aria-hidden
          />
        )}
      </>
    )
  }

  const effectiveEdge = layout?.edge ?? 'none'
  return (
    <div
      ref={rootRef}
      data-testid="workspace"
      data-mode={mode}
      data-active={active}
      data-shots={shots.length}
      data-picked={state.shotSelection.length}
      data-boxes={selection.length}
      data-redactions={doc.redactions.length}
      data-edge={effectiveEdge}
      data-size={`${doc.size.width}x${doc.size.height}`}
      data-fill={doc.fill}
      data-angle={doc.angle}
      data-light-color={doc.lightColor ?? style.glow}
      data-light-intensity={doc.lightIntensity}
      data-crop={doc.crop ? `${doc.crop.x},${doc.crop.y},${doc.crop.w},${doc.crop.h}` : 'none'}
      className="absolute inset-0 overflow-hidden bg-canvas select-none"
      style={{ cursor: hover.cursor, touchAction: 'none', ...dotBackground(g) }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={onDoubleClick}
      onContextMenu={(event) => event.preventDefault()}
    >
      {content}
    </div>
  )
}

/** Crop mode: the whole screenshot, at the canvas zoom. */
function CropImage({ bitmap, box }: { bitmap: ImageBitmap; box: { left: number; top: number; width: number; height: number } }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const backingWidth = Math.max(1, Math.min(4096, Math.round(box.width * dpr)))
  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const backingHeight = Math.max(1, Math.round((backingWidth * bitmap.height) / bitmap.width))
    if (canvas.width !== backingWidth) canvas.width = backingWidth
    if (canvas.height !== backingHeight) canvas.height = backingHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.clearRect(0, 0, backingWidth, backingHeight)
    ctx.drawImage(bitmap, 0, 0, backingWidth, backingHeight)
  }, [bitmap, backingWidth])
  return (
    <canvas
      ref={ref}
      data-testid="crop-canvas"
      className="pointer-events-none absolute"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      aria-label="Whole screenshot"
    />
  )
}
