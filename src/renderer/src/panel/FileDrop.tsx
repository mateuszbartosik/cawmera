import { useLayoutEffect, useRef } from 'react'
import { UploadSimple, X } from '@phosphor-icons/react'
import type { SourceEntry } from '../app/store'
import { cn } from '../ui/controls'

const ORIGIN: Record<SourceEntry['origin'], string> = {
  paste: 'pasted',
  drop: 'dropped',
  file: 'opened',
  capture: 'captured'
}

function Thumbnail({ source }: { source: SourceEntry }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const boxWidth = canvas.clientWidth * dpr
    const boxHeight = canvas.clientHeight * dpr
    canvas.width = Math.round(boxWidth)
    canvas.height = Math.round(boxHeight)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const scale = Math.min(boxWidth / source.width, boxHeight / source.height)
    const w = source.width * scale
    const h = source.height * scale
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source.bitmap, (boxWidth - w) / 2, (boxHeight - h) / 2, w, h)
  }, [source])
  return <canvas ref={ref} className="block h-[112px] w-full rounded-md" aria-label={`${source.name} thumbnail`} />
}

/** File drop: the only place a source is attached; canvas drops route here. */
export function FileDrop({
  source,
  dragOver,
  onBrowse,
  onClear
}: {
  source: SourceEntry | null
  dragOver: boolean
  onBrowse: () => void
  onClear: () => void
}) {
  if (!source) {
    return (
      <button
        type="button"
        data-testid="file-drop"
        onClick={onBrowse}
        className={cn(
          'flex h-[92px] w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-xs text-(--tc-label) transition-colors outline-none focus-visible:border-(--tc-accent)',
          dragOver ? 'border-(--tc-accent) bg-(--tc-accent)/10 text-(--tc-fg)' : 'border-(--tc-dashed) hover:bg-(--tc-control)'
        )}
      >
        <UploadSimple size={16} />
        <span>Drop, paste or browse</span>
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div
        data-testid="file-drop"
        className={cn(
          'relative rounded-lg border border-dashed p-1.5 transition-colors',
          dragOver ? 'border-(--tc-accent) bg-(--tc-accent)/10' : 'border-(--tc-dashed)'
        )}
      >
        <Thumbnail source={source} />
        <button
          type="button"
          aria-label="Remove screenshot"
          onClick={onClear}
          className="absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
        >
          <X size={11} weight="bold" />
        </button>
      </div>
      <p className="text-[11px] leading-4 text-(--tc-value)" data-testid="source-meta">
        {source.width} × {source.height} px · {ORIGIN[source.origin]}
      </p>
    </div>
  )
}
