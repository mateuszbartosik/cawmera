import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { angleName, normalizeAngle } from '../app/doc'

const HEIGHT = 112
/** Radius of the light's circular orbit. */
const ORBIT = 40
const FRAME = { width: 32, height: 20 }

/**
 * Where the light comes from, as a direction around the shot (like Figma's light control): the
 * light orbits the frame in the middle; drag it anywhere on the pad. Shift snaps to 15°.
 * The orbit is a circle, so every direction reads as equally close: in the export the light sits
 * just outside whichever edge it comes from.
 */
export function LightPad({
  angle,
  glow,
  onChange,
  onDragStart,
  onDragEnd
}: {
  angle: number
  /** House glow colour, so the control shows the light the plate uses. */
  glow: string
  /** `history: false` while dragging; the drag ends with onDragEnd. */
  onChange: (angle: number, history: boolean) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [width, setWidth] = useState(276)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth || 276))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const cx = width / 2
  const cy = HEIGHT / 2

  const angleAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = ref.current!.getBoundingClientRect()
    const dx = (event.clientX - box.left - cx) / ORBIT
    const dy = (event.clientY - box.top - cy) / ORBIT
    if (Math.hypot(dx, dy) < 0.05) return angle
    const raw = (Math.atan2(dx, -dy) * 180) / Math.PI
    return normalizeAngle(event.shiftKey ? Math.round(raw / 15) * 15 : raw)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    ref.current!.focus()
    ref.current!.setPointerCapture(event.pointerId)
    dragging.current = true
    onDragStart()
    onChange(angleAt(event), false)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) onChange(angleAt(event), false)
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    ref.current?.releasePointerCapture?.(event.pointerId)
    onDragEnd()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 15 : 1
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : 0
    if (!delta) return
    event.preventDefault()
    onChange(normalizeAngle(angle + delta), true)
  }

  const rad = (angle * Math.PI) / 180
  const kx = cx + ORBIT * Math.sin(rad)
  const ky = cy - ORBIT * Math.cos(rad)
  // A soft beam from the light to the shot in the middle.
  const len = Math.hypot(cx - kx, cy - ky) || 1
  const px = (-(cy - ky) / len) * 8
  const py = ((cx - kx) / len) * 8
  const { width: frameW, height: frameH } = FRAME

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Light direction"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={angle}
      aria-valuetext={`${angle}°, from the ${angleName(angle)}`}
      title={`From the ${angleName(angle)}`}
      data-testid="light-pad"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className="relative w-full shrink-0 cursor-pointer touch-none overflow-hidden rounded-lg border border-(--tc-line) bg-(--tc-control) outline-none select-none focus-visible:ring-2 focus-visible:ring-(--tc-accent)/60"
      style={{ height: HEIGHT }}
    >
      <svg width={width} height={HEIGHT} className="pointer-events-none absolute inset-0" aria-hidden>
        <defs>
          <linearGradient id="light-beam" gradientUnits="userSpaceOnUse" x1={kx} y1={ky} x2={cx} y2={cy}>
            <stop offset="0" stopColor={glow} stopOpacity={0.55} />
            <stop offset="1" stopColor={glow} stopOpacity={0} />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={ORBIT} fill="none" stroke="var(--tc-line)" strokeWidth={1} strokeDasharray="2 4" data-testid="light-orbit" />
        <path d={`M${kx} ${ky}L${cx + px} ${cy + py}L${cx - px} ${cy - py}Z`} fill="url(#light-beam)" />
        <rect x={cx - frameW / 2} y={cy - frameH / 2} width={frameW} height={frameH} rx={3} fill="var(--tc-panel-solid)" stroke="var(--tc-label)" strokeWidth={1.25} />
        <circle cx={kx} cy={ky} r={6} fill={glow} stroke="var(--tc-panel-solid)" strokeWidth={2} />
      </svg>
    </div>
  )
}
