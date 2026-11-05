import { ArrowsDownUp } from '@phosphor-icons/react'
import { MAX_SIDE, MIN_SIDE, presetFor, ratioLabel, SIZE_PRESETS } from '../app/size'
import type { Size } from '../render/geometry'
import { Field, IconButton, NumberField, Select } from '../ui/controls'

const OPTIONS = SIZE_PRESETS.map((preset) => ({ value: preset.name, label: preset.name, detail: `${preset.width} × ${preset.height}` }))

/** A preset, or any width and height typed in. */
export function SizeField({ size, onChange }: { size: Size; onChange: (size: Size) => void }) {
  const choosePreset = (name: string) => {
    const preset = SIZE_PRESETS.find((candidate) => candidate.name === name)
    if (preset) onChange({ width: preset.width, height: preset.height })
  }
  return (
    <Field
      label="Size"
      help={`Width and height of the image, ${MIN_SIDE}–${MAX_SIDE} px. The screenshot keeps its scale, so a smaller image shows less of it.`}
      value={<span data-testid="size-ratio">{ratioLabel(size)}</span>}
    >
      <Select
        label="Size preset"
        value={presetFor(size)?.name ?? null}
        options={OPTIONS}
        placeholder="Custom"
        detail={`${size.width} × ${size.height}`}
        onChange={choosePreset}
        testId="size-preset"
      />
      <div className="flex items-center gap-1.5">
        <NumberField label="Width" prefix="W" grow value={size.width} min={MIN_SIDE} max={MAX_SIDE} onChange={(width) => onChange({ ...size, width })} testId="size-width" />
        <span className="text-xs text-(--tc-value)" aria-hidden>
          ×
        </span>
        <NumberField label="Height" prefix="H" grow value={size.height} min={MIN_SIDE} max={MAX_SIDE} onChange={(height) => onChange({ ...size, height })} testId="size-height" />
        <IconButton label="Swap width and height" onClick={() => onChange({ width: size.height, height: size.width })} data-testid="size-swap">
          <ArrowsDownUp size={14} />
        </IconButton>
      </div>
    </Field>
  )
}
