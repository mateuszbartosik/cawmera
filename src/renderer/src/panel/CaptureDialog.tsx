import { useEffect, useRef, useState } from 'react'
import { AppWindow, Monitor, X } from '@phosphor-icons/react'
import type { CaptureSource } from '@shared/types'
import { cancelCapture, captureSource } from '../app/actions'
import { useApp } from '../app/store'
import { bridge } from '../platform/bridge'
import { cn } from '../ui/controls'

type Kind = CaptureSource['kind']

/** Desktop source picker: our own dialog instead of the OS one, so the delay and density are ours too. */
export function CaptureDialog() {
  const open = useApp((s) => s.capture.phase === 'picking') && bridge !== null
  const delay = useApp((s) => s.delay)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [sources, setSources] = useState<CaptureSource[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind>('window')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
    if (!open) return
    setSources(null)
    setError(null)
    let alive = true
    bridge!
      .listCaptureSources()
      .then((list) => {
        if (!alive) return
        setSources(list)
        if (!list.some((source) => source.kind === 'window')) setKind('screen')
      })
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)))
    return () => {
      alive = false
    }
  }, [open])

  const shown = (sources ?? []).filter((source) => source.kind === kind)

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="capture-title"
      onCancel={(event) => {
        event.preventDefault()
        cancelCapture()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) cancelCapture()
      }}
      className="m-auto w-[min(760px,calc(100vw-48px))] rounded-xl border border-(--tc-line) bg-(--tc-panel-solid) p-0 text-(--tc-fg) shadow-2xl backdrop:bg-black/50"
    >
      {open && (
        <div className="flex max-h-[min(640px,calc(100vh-80px))] flex-col">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-(--tc-divider) pr-2 pl-4">
            <h2 id="capture-title" className="text-[13px] font-medium">
              Capture
            </h2>
            <div role="tablist" aria-label="Source type" className="flex h-7 gap-0.5 rounded-lg bg-(--tc-control) p-0.5">
              {(['window', 'screen'] as const).map((value) => (
                <button
                  key={value}
                  role="tab"
                  type="button"
                  aria-selected={kind === value}
                  onClick={() => setKind(value)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 text-xs font-medium',
                    kind === value ? 'bg-(--tc-chip) text-(--tc-fg)' : 'text-(--tc-label) hover:text-(--tc-fg)'
                  )}
                >
                  {value === 'window' ? <AppWindow size={13} /> : <Monitor size={13} />}
                  {value === 'window' ? 'Windows' : 'Screens'}
                </button>
              ))}
            </div>
            <span className="ml-auto text-xs text-(--tc-value)">{delay ? `Captures ${delay} s after you pick` : 'Captures right away'}</span>
            <button
              type="button"
              aria-label="Close"
              onClick={cancelCapture}
              className="grid size-7 place-items-center rounded-md text-(--tc-label) hover:bg-(--tc-control) hover:text-(--tc-fg)"
            >
              <X size={14} />
            </button>
          </header>

          <div className="min-h-[220px] overflow-y-auto p-4">
            {error && <p className="text-sm text-(--tc-label)">Couldn't list windows: {error}</p>}
            {!error && sources === null && <p className="text-sm text-(--tc-label)">Looking for windows…</p>}
            {!error && sources !== null && shown.length === 0 && (
              <p className="text-sm text-(--tc-label)">Nothing to capture here.</p>
            )}
            <ul className="grid grid-cols-3 gap-3">
              {shown.map((source) => (
                <li key={source.id}>
                  <button
                    type="button"
                    onClick={() => void captureSource(source)}
                    className="group flex w-full flex-col gap-2 rounded-lg p-1.5 text-left outline-none hover:bg-(--tc-control) focus-visible:ring-2 focus-visible:ring-(--tc-accent)"
                  >
                    <span className="grid aspect-[16/10] w-full place-items-center overflow-hidden rounded-md bg-black/40 ring-1 ring-(--tc-line) group-hover:ring-(--tc-accent)">
                      {source.thumbnail ? (
                        <img src={source.thumbnail} alt="" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <Monitor size={28} className="text-(--tc-label)" />
                      )}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 px-0.5 text-xs text-(--tc-fg)">
                      {source.appIcon ? (
                        <img src={source.appIcon} alt="" className="size-3.5 shrink-0" />
                      ) : source.kind === 'screen' ? (
                        <Monitor size={13} className="shrink-0" />
                      ) : (
                        <AppWindow size={13} className="shrink-0" />
                      )}
                      <span className="truncate">{source.name}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </dialog>
  )
}
