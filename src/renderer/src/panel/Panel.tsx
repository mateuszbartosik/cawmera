import { useRef } from 'react'
import { ArrowCounterClockwise, Camera, Copy, Crop, Plus, Shuffle, Stack, UploadSimple } from '@phosphor-icons/react'
import { EDGE_NAMES, exportFileName, FORMAT_LABEL, type Density, type Doc, type ExportFormat, type RedactStyle, type UiZoom } from '../app/doc'
import { OUTPUT, type HouseStyle } from '../app/house-style'
import {
  addRedaction,
  addSpotlight,
  clearSource,
  copyImage,
  enterCrop,
  exportAll,
  exportHouseStyle,
  exportImage,
  importHouseStyle,
  leaveCrop,
  openFilePicker,
  resetAll,
  resetHouseStyle,
  resetRedactions,
  resetScreenshotSection,
  resetSpotlight,
  resetBackground,
  setAngle,
  setEdge,
  setFileName,
  setLightColor,
  setLightIntensity,
  shuffleBackground,
  startCapture
} from '../app/actions'
import { commitFrom, getSource, store, updateDoc, useApp, type CaptureDelay } from '../app/store'
import { isDesktop } from '../platform/bridge'
import { computeLayout } from '../render/layout'
import { ActionsRow, Button, ColorField, Field, IconButton, NumberField, Section, Segmented, Slider, Switch, TextField } from '../ui/controls'
import { EdgePicker } from './EdgePicker'
import { FileDrop } from './FileDrop'
import { LightPad } from './LightPad'
import { isNarrow, PANEL_GAP, PANEL_WIDTH, SHEET_SHARE } from '../canvas/view'

const DELAYS: { value: CaptureDelay; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 3, label: '3 s' },
  { value: 5, label: '5 s' },
  { value: 10, label: '10 s' }
]
const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: 1, label: '1×' },
  { value: 1.25, label: '1.25×' },
  { value: 1.5, label: '1.5×' },
  { value: 2, label: '2×' }
]
const ZOOM_OPTIONS: { value: UiZoom; label: string }[] = [
  { value: 1, label: '100%' },
  { value: 0.8, label: '80%' },
  { value: 0.6, label: '60%' }
]
const REDACT_OPTIONS: { value: RedactStyle; label: string }[] = [
  { value: 'blur', label: 'Blur' },
  { value: 'pixelate', label: 'Pixelate' },
  { value: 'solid', label: 'Solid' }
]
const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = (['webp', 'png'] as const).map((value) => ({ value, label: FORMAT_LABEL[value] }))

const percent = (value: number) => `${Math.round(value * 100)}%`
const px = (value: number) => `${Math.round(value)}px`

function useSection(id: string) {
  const collapsed = useApp((s) => !!s.collapsed[id])
  const toggle = () => store.set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } }))
  return { collapsed, onToggle: toggle }
}

function EdgeField({ doc, style }: { doc: Doc; style: HouseStyle }) {
  const source = getSource(doc.sourceId)
  if (!source) return null
  const effective = computeLayout(source, doc.crop, doc.capturedAt, doc.zoom, doc.edge, style).edge
  return (
    <Field
      label="Edge"
      help="Where the screenshot comes in from: it runs off that side or corner. The middle keeps the whole frame inside. Auto comes in from the right or bottom only where the screenshot doesn't fit."
      value={
        doc.edge === null ? (
          <span data-testid="edge-mode">Auto</span>
        ) : (
          <button type="button" data-testid="edge-auto" onClick={() => setEdge(null)} className="text-xs text-(--tc-label) underline-offset-2 hover:text-(--tc-fg) hover:underline">
            Back to auto
          </button>
        )
      }
    >
      <div className="flex items-center gap-3">
        <EdgePicker value={doc.edge} effective={effective} onChange={setEdge} />
        <span className="text-xs text-(--tc-value)">{effective === 'c' ? 'Fully inside' : `From the ${EDGE_NAMES[effective].toLowerCase()}`}</span>
      </div>
    </Field>
  )
}

function ScreenshotSection() {
  const doc = useApp((s) => s.doc)
  const style = useApp((s) => s.style)
  const mode = useApp((s) => s.mode)
  const delay = useApp((s) => s.delay)
  const capture = useApp((s) => s.capture)
  const dragOver = useApp((s) => s.dragOver)
  const source = getSource(doc.sourceId)
  const section = useSection('screenshot')
  const busy = capture.phase !== 'idle'
  const captureLabel =
    capture.phase === 'countdown' ? `In ${capture.remaining}…` : capture.phase === 'grabbing' ? 'Capturing…' : capture.phase === 'picking' ? 'Picking…' : 'Capture'

  return (
    <Section title="Screenshot" testId="section-screenshot" {...section} onReset={source ? resetScreenshotSection : undefined}>
      <FileDrop source={source} dragOver={dragOver} onBrowse={openFilePicker} onClear={clearSource} />
      <ActionsRow>
        <Button
          icon={<Camera size={14} />}
          onClick={startCapture}
          disabled={busy}
          data-testid="capture"
          className={source ? undefined : 'col-span-2'}
          hint={isDesktop ? 'Pick a window or a screen (Ctrl+Shift+2)' : 'Pick the tab or window in the browser dialog'}
        >
          {captureLabel}
        </Button>
        {source && (
          <Button
            icon={<Crop size={14} />}
            pressed={mode === 'crop'}
            onClick={mode === 'crop' ? leaveCrop : enterCrop}
            data-testid="crop"
            hint="Choose which part of the screenshot shows (C, or double-click the shot)"
          >
            Crop
          </Button>
        )}
      </ActionsRow>
      <Segmented
        label="Capture delay"
        help="Waits before capturing, so a menu or dropdown can be open in the shot. A countdown shows on the screen."
        value={delay}
        options={DELAYS}
        onChange={(value) => store.set({ delay: value })}
        testId="delay"
      />
      {source && (
        <>
          <EdgeField doc={doc} style={style} />
          <Segmented
            label="Captured at"
            help="Display scaling when the shot was taken. Read from this screen; change it if the UI looks too big or too small."
            value={doc.capturedAt}
            options={DENSITY_OPTIONS}
            onChange={(value) => updateDoc({ capturedAt: value })}
            testId="captured-at"
          />
          <Segmented
            label="UI zoom"
            help="How large the captured UI appears. Keep 100% so every image matches; go smaller to show more of the screenshot."
            value={doc.zoom}
            options={ZOOM_OPTIONS}
            onChange={(value) => updateDoc({ zoom: value })}
            testId="ui-zoom"
          />
        </>
      )}
    </Section>
  )
}

function BackgroundSection() {
  const angle = useApp((s) => s.doc.angle)
  const lightColor = useApp((s) => s.doc.lightColor)
  const intensity = useApp((s) => s.doc.lightIntensity)
  const houseColor = useApp((s) => s.style.glow)
  const section = useSection('background')
  const before = useRef<Doc | null>(null)
  const color = lightColor ?? houseColor
  const customized = lightColor !== null || intensity !== 1
  const startDrag = () => {
    before.current ??= store.get().doc
  }
  const endDrag = () => {
    if (before.current) commitFrom(before.current)
    before.current = null
  }
  return (
    <Section
      title="Background"
      testId="section-background"
      {...section}
      actions={
        <IconButton label="Random light direction" shortcut="R" onClick={shuffleBackground} data-testid="shuffle">
          <Shuffle size={13} />
        </IconButton>
      }
      onReset={customized ? resetBackground : undefined}
      resetLabel="House light colour and intensity"
    >
      <Field
        label="Light"
        help="Where the light comes from: drag it round the shot (Shift snaps to 15°). New shots get a random direction, so neighbouring images never match."
        value={<NumberField label="Light angle" value={angle} suffix="°" min={0} max={359} wrap compact onChange={(value) => setAngle(value)} testId="light-angle" />}
      >
        <LightPad angle={angle} glow={color} onChange={setAngle} onDragStart={startDrag} onDragEnd={endDrag} />
      </Field>
      <ColorField label="Colour" value={color} onChange={(value) => setLightColor(value === houseColor ? null : value)} />
      <Slider
        label="Intensity"
        help="100% is the house strength; lower it for a quieter light. New shots keep this shot's colour and intensity."
        value={intensity}
        min={0}
        max={1}
        step={0.05}
        format={percent}
        onChange={(value) => {
          startDrag()
          setLightIntensity(value, false)
        }}
        onCommit={endDrag}
      />
    </Section>
  )
}

function RedactSection() {
  const doc = useApp((s) => s.doc)
  const section = useSection('redact')
  const hasBoxes = doc.redactions.length > 0
  return (
    <Section
      title="Redact"
      testId="section-redact"
      {...section}
      empty={!hasBoxes}
      actions={
        <IconButton label="Add blur box" shortcut="or Alt+drag" onClick={addRedaction} data-testid="add-blur">
          <Plus size={14} />
        </IconButton>
      }
      onReset={hasBoxes ? resetRedactions : undefined}
      resetLabel="Remove all boxes"
    >
      {hasBoxes && (
        <Segmented
          label="Style"
          help="Every style destroys the pixels underneath, so nothing can be recovered from the image."
          value={doc.redactStyle}
          options={REDACT_OPTIONS}
          onChange={(value) => updateDoc({ redactStyle: value })}
          testId="redact-style"
        />
      )}
    </Section>
  )
}

function SpotlightSection() {
  const spotlight = useApp((s) => s.doc.spotlight)
  const section = useSection('spotlight')
  return (
    <Section
      title="Spotlight"
      testId="section-spotlight"
      {...section}
      empty={!spotlight.on}
      actions={
        !spotlight.on && (
          <IconButton label="Add spotlight" onClick={addSpotlight} data-testid="add-spotlight">
            <Plus size={14} />
          </IconButton>
        )
      }
      onReset={spotlight.on ? resetSpotlight : undefined}
      resetLabel="Remove spotlight"
    >
      {spotlight.on && (
        <>
          <Slider
            label="Dim"
            help="How much the area outside the box is darkened."
            value={spotlight.dim}
            min={0.2}
            max={0.85}
            step={0.05}
            format={percent}
            onChange={(dim) => updateDoc((d) => ({ spotlight: { ...d.spotlight, dim } }))}
          />
          <Switch label="Outline" checked={spotlight.outline} onChange={(outline) => updateDoc((d) => ({ spotlight: { ...d.spotlight, outline } }))} />
        </>
      )}
    </Section>
  )
}

function HouseStyleSection() {
  const style = useApp((s) => s.style)
  const section = useSection('house-style')
  const set = (patch: Partial<HouseStyle>) => store.set((s) => ({ style: { ...s.style, ...patch } }))
  return (
    <Section title="House style" testId="section-house-style" {...section} onReset={resetHouseStyle} resetLabel="Back to the default house style">
      <TextField
        label="Name"
        help="Shown to people when they import the style, e.g. your product's name."
        value={style.name}
        placeholder="Untitled"
        onChange={(name) => set({ name: name.slice(0, 40) })}
        testId="style-name"
      />
      <Slider
        label="Design width"
        help="How wide the image will be shown, e.g. the column of your docs or blog. At 100% zoom the captured UI appears at its real size at this width. 800 keeps Retina captures pixel-exact."
        value={style.designWidth}
        min={480}
        max={1000}
        step={20}
        format={px}
        onChange={(designWidth) => set({ designWidth })}
      />
      <div className="grid grid-cols-2 gap-2">
        <ColorField label="Lit side" value={style.plateFrom} onChange={(plateFrom) => set({ plateFrom })} />
        <ColorField label="Far side" value={style.plateTo} onChange={(plateTo) => set({ plateTo })} />
        <ColorField label="Light colour" value={style.glow} onChange={(glow) => set({ glow })} />
        <ColorField label="Spotlight" value={style.accent} onChange={(accent) => set({ accent })} />
      </div>
      <Slider label="Light strength" help="What 100% intensity means in Background." value={style.glowStrength} min={0} max={1} step={0.01} format={percent} onChange={(glowStrength) => set({ glowStrength })} />
      <Slider label="Inset" help="Distance of the frame from the edges it doesn't come in from, in export pixels." value={style.inset} min={32} max={200} step={4} format={px} onChange={(inset) => set({ inset })} />
      <Slider label="Corners" value={style.radius} min={0} max={48} step={1} format={px} onChange={(radius) => set({ radius })} />
      <Slider label="Shadow" value={style.shadow} min={0} max={1} step={0.05} format={percent} onChange={(shadow) => set({ shadow })} />
      <Slider label="Border" value={style.border} min={0} max={0.5} step={0.01} format={percent} onChange={(border) => set({ border })} />
      <ActionsRow>
        <Button icon={<UploadSimple size={14} />} onClick={exportHouseStyle}>
          Export style
        </Button>
        <Button icon={<UploadSimple size={14} className="rotate-180" />} onClick={importHouseStyle}>
          Import style
        </Button>
      </ActionsRow>
    </Section>
  )
}

function ExportSection() {
  const fileName = useApp((s) => s.doc.fileName)
  const format = useApp((s) => s.format)
  const index = useApp((s) => s.shots.findIndex((record) => record.id === s.activeId))
  const section = useSection('export')
  const fallback = `whats-new-shot-${index + 1}`
  return (
    <Section title="Export" testId="section-export" {...section}>
      <TextField
        label="File name"
        help="Name it after the page and the feature, like billing-cost-breakdown."
        value={fileName}
        placeholder={fallback}
        suffix={`.${format}`}
        testId="file-name"
        onChange={(value) => setFileName(value)}
        onCommit={() => setFileName(fileName, true)}
      />
      <Segmented
        label="Format"
        help="WebP is lossless here: the same pixels as PNG at about half the size. Copy always puts a PNG on the clipboard."
        value={format}
        options={FORMAT_OPTIONS}
        onChange={(value) => store.set({ format: value })}
        testId="format"
      />
      <p className="-mt-1 text-[11px] leading-4 text-(--tc-value)" data-testid="export-spec" title={exportFileName(fileName, format, fallback)}>
        {OUTPUT.width} × {OUTPUT.height} px · 16:10 · lossless
      </p>
    </Section>
  )
}

export function Panel() {
  const hasSource = useApp((s) => s.doc.sourceId !== null)
  const houseStyleOpen = useApp((s) => s.houseStyleOpen)
  const narrow = useApp((s) => isNarrow(s))
  const format = useApp((s) => s.format)
  // The active shot's live document can have an image its stored record doesn't have yet.
  const ready = useApp((s) => s.shots.filter((record) => (record.id === s.activeId ? s.doc : record.doc).sourceId !== null).length)

  return (
    <aside
      data-testid="panel"
      aria-label="Controls"
      className="absolute flex flex-col overflow-hidden rounded-lg border border-(--tc-line) bg-(--tc-panel) text-(--tc-fg) shadow-[var(--tc-panel-shadow)] backdrop-blur-[40px] backdrop-saturate-150"
      style={
        narrow
          ? { left: PANEL_GAP, right: PANEL_GAP, bottom: PANEL_GAP, height: `${SHEET_SHARE * 100}%` }
          : { top: PANEL_GAP, right: PANEL_GAP, bottom: PANEL_GAP, width: PANEL_WIDTH }
      }
    >
      <header className="flex h-9 shrink-0 items-center gap-0.5 pr-1.5 pl-3">
        <h1 className="flex-1 text-[13px] leading-[18px] font-medium">Cawmera</h1>
        {hasSource && (
          <IconButton label="Reset this shot" side="bottom" onClick={resetAll}>
            <ArrowCounterClockwise size={13} />
          </IconButton>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-(--tc-divider) [scrollbar-width:thin]">
        <ScreenshotSection />
        <BackgroundSection />
        {hasSource && <RedactSection />}
        {hasSource && <SpotlightSection />}
        {houseStyleOpen && <HouseStyleSection />}
        <ExportSection />
      </div>
      <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-(--tc-divider) p-3">
        <Button icon={<Copy size={14} />} onClick={() => void copyImage()} data-testid="copy" hint="Copy as PNG (Ctrl+Shift+C)">
          Copy
        </Button>
        <Button variant="primary" icon={<UploadSimple size={14} />} onClick={() => void exportImage()} data-testid="export" hint="Save this shot (Ctrl+S)">
          Export {FORMAT_LABEL[format]}
        </Button>
        {ready > 1 && (
          <Button
            className="col-span-2"
            icon={<Stack size={14} />}
            onClick={() => void exportAll()}
            data-testid="export-all"
            hint="Save every shot into one folder (Ctrl+Shift+S)"
          >
            Export all {ready} · {FORMAT_LABEL[format]}
          </Button>
        )}
      </footer>
    </aside>
  )
}
