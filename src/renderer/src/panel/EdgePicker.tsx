import { useRef, useState, type KeyboardEvent } from 'react'
import { EDGE_NAMES, EDGES, edgeDirections, type Edge } from '../app/doc'
import { cn } from '../ui/controls'

/** The frame's silhouette inside the little plate, per edge (percent of the plate). */
function silhouette(edge: Edge) {
  const { x, y } = edgeDirections(edge)
  const [left, right] = x === -1 ? [-14, 70] : x === 1 ? [30, 114] : [18, 82]
  const [top, bottom] = y === -1 ? [-18, 68] : y === 1 ? [32, 118] : [20, 80]
  return { left: `${left}%`, top: `${top}%`, width: `${right - left}%`, height: `${bottom - top}%` }
}

/**
 * The edge the screenshot comes in from, as a 3 × 3 picker on a little plate: corners and sides
 * run the frame off that edge, the middle keeps it inside.
 */
export function EdgePicker({ value, effective, onChange }: { value: Edge | null; effective: Edge; onChange: (edge: Edge) => void }) {
  const [hovered, setHovered] = useState<Edge | null>(null)
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const current = value ?? effective

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = EDGES.indexOf(current)
    const col = index % 3
    const row = Math.floor(index / 3)
    const next =
      event.key === 'ArrowLeft' ? [Math.max(0, col - 1), row] : event.key === 'ArrowRight' ? [Math.min(2, col + 1), row] : event.key === 'ArrowUp' ? [col, Math.max(0, row - 1)] : event.key === 'ArrowDown' ? [col, Math.min(2, row + 1)] : null
    if (!next) return
    event.preventDefault()
    const target = EDGES[next[1] * 3 + next[0]]
    onChange(target)
    refs.current[EDGES.indexOf(target)]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label="Edge the screenshot comes in from"
      data-testid="edge"
      onKeyDown={onKeyDown}
      onPointerLeave={() => setHovered(null)}
      className="relative h-[60px] w-24 shrink-0 overflow-hidden rounded-lg border border-(--tc-line) bg-(--tc-control)"
    >
      {hovered && hovered !== current && (
        <span
          className="pointer-events-none absolute rounded-[3px] border border-dashed border-(--tc-label)"
          style={silhouette(hovered)}
          aria-hidden
        />
      )}
      <span
        className="pointer-events-none absolute rounded-[3px] border-[1.5px] border-(--tc-fg)/70 bg-(--tc-fg)/15 transition-[left,top,width,height] duration-150 ease-out"
        style={silhouette(current)}
        aria-hidden
      />
      <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
        {EDGES.map((edge, i) => {
          const selected = edge === current
          return (
            <button
              key={edge}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={edge === 'c' ? 'Fully inside' : `From the ${EDGE_NAMES[edge].toLowerCase()}`}
              title={edge === 'c' ? 'Fully inside' : `Comes in from the ${EDGE_NAMES[edge].toLowerCase()}`}
              data-testid={`edge-${edge}`}
              tabIndex={selected ? 0 : -1}
              onPointerEnter={() => setHovered(edge)}
              onClick={() => onChange(edge)}
              className="grid place-items-center outline-none focus-visible:bg-(--tc-accent)/15"
            >
              <span className={cn('size-[3px] rounded-full bg-(--tc-label) transition-opacity', selected ? 'opacity-0' : 'opacity-70')} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
