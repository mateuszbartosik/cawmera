import { useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { ImageSquare, X } from '@phosphor-icons/react'
import { pickBackgroundImage, removeBackgroundImage, setBackgroundImage } from '../app/actions'
import { BACKDROP_MAX_SIDE } from '../app/backdrop'
import { cn, Field } from '../ui/controls'

function Thumbnail({ bitmap }: { bitmap: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(canvas.clientWidth * dpr)
    canvas.height = Math.round(canvas.clientHeight * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height)
    const w = bitmap.width * scale
    const h = bitmap.height * scale
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
  }, [bitmap])
  return <canvas ref={ref} className="block h-[112px] w-full rounded-md" aria-label="Background image" />
}

/** The house background image: drop or browse one, replace it, or take it out. */
export function BackdropField({ hasImage, bitmap }: { hasImage: boolean; bitmap: ImageBitmap | null }) {
  const [over, setOver] = useState(false)
  const dropTarget = {
    onDragOver: (event: DragEvent) => {
      event.preventDefault()
      setOver(true)
    },
    onDragLeave: () => setOver(false),
    // Handled here, so the window doesn't take the file for a screenshot.
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      setOver(false)
      const file = [...event.dataTransfer.files].find((candidate) => candidate.type.startsWith('image/'))
      if (file) void setBackgroundImage(file)
    }
  }
  return (
    <Field
      label="Image"
      help={`Saved in the house style: every shot set to Image uses it, and Export style includes it. Larger than ${BACKDROP_MAX_SIDE} px is scaled down.`}
    >
      {hasImage ? (
        <div className="flex flex-col gap-1.5">
          <div
            data-testid="backdrop-drop"
            className={cn('relative rounded-lg border border-dashed p-1.5 transition-colors', over ? 'border-(--tc-accent) bg-(--tc-accent)/10' : 'border-(--tc-dashed)')}
            {...dropTarget}
          >
            <button type="button" aria-label="Replace background image" title="Replace" onClick={pickBackgroundImage} className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-(--tc-accent)/50">
              {bitmap ? <Thumbnail bitmap={bitmap} /> : <span className="block h-[112px] w-full rounded-md bg-(--tc-control)" />}
            </button>
            <button
              type="button"
              aria-label="Remove background image"
              data-testid="backdrop-remove"
              onClick={removeBackgroundImage}
              className="absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
            >
              <X size={11} weight="bold" />
            </button>
          </div>
          <p className="text-[11px] leading-4 text-(--tc-value)" data-testid="backdrop-meta">
            {bitmap ? `${bitmap.width} × ${bitmap.height} px · in the house style` : 'Loading…'}
          </p>
        </div>
      ) : (
        <button
          type="button"
          data-testid="backdrop-drop"
          onClick={pickBackgroundImage}
          className={cn(
            'flex h-[92px] w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-xs text-(--tc-label) transition-colors outline-none focus-visible:border-(--tc-accent)',
            over ? 'border-(--tc-accent) bg-(--tc-accent)/10 text-(--tc-fg)' : 'border-(--tc-dashed) hover:bg-(--tc-control)'
          )}
          {...dropTarget}
        >
          <ImageSquare size={16} />
          <span>Drop or browse an image</span>
        </button>
      )}
    </Field>
  )
}
