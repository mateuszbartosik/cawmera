import { useEffect, type CSSProperties } from 'react'
import { Toaster, toast } from 'sonner'
import type { MenuCommand } from '@shared/types'
import { CropBar } from '../canvas/CropBar'
import { SelectionBar } from '../canvas/SelectionBar'
import { Workspace } from '../canvas/Workspace'
import { isNarrow, PANEL_GAP, shotAt, toWorld, workspaceGeometry, zoomFit, zoomStep, zoomTo, zoomToActive } from '../canvas/view'
import { CaptureDialog } from '../panel/CaptureDialog'
import { Panel } from '../panel/Panel'
import { bridge } from '../platform/bridge'
import { exportRecording, finishRecording, recordingFailed } from '../recording/actions'
import { Timeline } from '../timeline/Timeline'
import { Toolbar } from '../toolbar/Toolbar'
import {
  cancelCapture,
  copyImage,
  deletePickedShots,
  enterCrop,
  exportAll,
  exportImage,
  leaveCrop,
  loadFiles,
  newShot,
  nudgeSelected,
  openFilePicker,
  pasteFromEvent,
  removeSelected,
  selectAllBoxes,
  shuffleLook,
  startCapture,
  stepShot
} from './actions'
import { clearPickedShots, isUnsaved, liveShots, pickAllShots, redo, selectShot, store, undo, useApp } from './store'

function runCommand(command: MenuCommand) {
  switch (command) {
    case 'open':
      return openFilePicker()
    case 'capture':
      return startCapture()
    case 'new-shot':
      return newShot()
    case 'next-shot':
      return stepShot(1)
    case 'previous-shot':
      return stepShot(-1)
    case 'export':
      return void (store.get().doc.recording ? exportRecording() : exportImage())
    case 'export-all':
      return void exportAll()
    case 'copy':
      if (!store.get().doc.recording) void copyImage()
      return
    case 'undo':
      return undo()
    case 'redo':
      return redo()
    case 'fit':
      return zoomFit()
    case 'fit-shot':
      return zoomToActive()
    case 'zoom-in':
      return zoomStep(1)
    case 'zoom-out':
      return zoomStep(-1)
    case 'zoom-100':
      return zoomTo(1)
    case 'toggle-theme':
      return store.set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' }))
    case 'toggle-house-style':
      return store.set((s) => ({ houseStyleOpen: !s.houseStyleOpen }))
    case 'about':
      void (bridge?.getVersion() ?? Promise.resolve('web')).then((version) =>
        toast('Cawmera', { description: `Version ${version}. Puts a screenshot into a frame.` })
      )
      return
  }
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
}

function onKeyDown(event: KeyboardEvent) {
  // A focused control (segmented arrows, a shot in the list, the dialog) already handled it.
  if (event.defaultPrevented) return
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  const typing = isTyping(event.target)
  const s = store.get()

  if (s.capture.phase === 'picking') return // the dialog owns the keyboard

  const run = (command: MenuCommand) => {
    event.preventDefault()
    runCommand(command)
  }
  if (mod && event.shiftKey && key === 's') return run('export-all')
  if (mod && key === 's') return run('export')
  if (mod && key === 'o') return run('open')
  if (mod && key === 'n') return run('new-shot')
  if (mod && key === 'pagedown') return run('next-shot')
  if (mod && key === 'pageup') return run('previous-shot')
  if (mod && event.shiftKey && key === 'c') return run('copy')
  if (mod && event.shiftKey && event.code === 'Digit2') return run('capture')
  if (mod && event.shiftKey && key === 'l') return run('toggle-theme')
  if (mod && event.altKey && event.code === 'KeyH') return run('toggle-house-style')
  if (mod && (key === '=' || key === '+')) return run('zoom-in')
  if (mod && (key === '-' || key === '_')) return run('zoom-out')
  if (mod && key === '0') return run('zoom-100')
  if (typing) return
  if (mod && key === 'z') return run(event.shiftKey ? 'redo' : 'undo')
  if (mod && key === 'y') return run('redo')
  if (mod && key === 'a') {
    // Select all: the boxes of this shot when one is selected, otherwise every shot.
    event.preventDefault()
    if (s.mode === 'compose') void (s.selection.length > 0 ? selectAllBoxes() : pickAllShots())
    return
  }
  if (mod || event.altKey) return

  if (event.shiftKey && event.code === 'Digit1') return run('fit')
  if (event.shiftKey && event.code === 'Digit2') return run('fit-shot')
  if (key === 'c' && s.doc.sourceId) return void (s.mode === 'crop' ? leaveCrop() : enterCrop())
  if (key === 'r') return void shuffleLook()
  if ((key === 'enter' || key === 'escape') && s.mode === 'crop') return void (event.preventDefault(), leaveCrop())
  if (key === 'escape' && s.selection.length > 0) return void store.set({ selection: [] })
  if (key === 'escape' && s.timelineSelection) return void store.set({ timelineSelection: null })
  if (key === 'escape' && s.shotSelection.length > 0) return void clearPickedShots()
  const deleting = key === 'delete' || key === 'backspace'
  if (deleting && s.selection.length > 0) return void (event.preventDefault(), removeSelected())
  if (deleting && s.timelineSelection) return
  if (deleting && s.shotSelection.length > 0) return void (event.preventDefault(), deletePickedShots())
  if (key.startsWith('arrow') && s.selection.length > 0) {
    const step = event.shiftKey ? 10 : 1
    const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0
    const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0
    event.preventDefault()
    nudgeSelected(dx, dy)
  }
}

const TOAST_WIDTH = 320

export function App() {
  const theme = useApp((s) => s.theme)
  const narrow = useApp((s) => isNarrow(s))
  const toastLeft = useApp((s) => {
    const { area } = workspaceGeometry(s)
    return Math.max(PANEL_GAP, Math.round(area.x + area.width / 2 - TOAST_WIDTH / 2))
  })
  // Narrow layout: the toolbar (and crop bar) sit at the top, so toasts go just below them.
  const cropping = useApp((s) => s.mode === 'crop')
  const toastTop = narrow ? (cropping ? 102 : 56) : 16

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    bridge?.setNativeTheme(theme)
  }, [theme])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => void pasteFromEvent(event)
    // Pinch / Ctrl+wheel must never zoom the whole UI.
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) event.preventDefault()
    }
    let depth = 0
    const hasFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes('Files')
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth += 1
      store.set({ dragOver: true })
    }
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) store.set({ dragOver: false })
    }
    const onDragOver = (event: DragEvent) => {
      event.preventDefault()
      if (event.dataTransfer && hasFiles(event)) event.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (event: DragEvent) => {
      depth = 0
      store.set({ dragOver: false })
      // A drop zone that takes the files itself (the background image) already handled them.
      if (event.defaultPrevented) return
      event.preventDefault()
      const files = [...(event.dataTransfer?.files ?? [])]
      if (!files.length) return
      // Dropped onto an empty shot: fill that one.
      const s = store.get()
      if (s.mode === 'compose') {
        const shots = liveShots(s)
        const index = shotAt(
          shots.map((record) => record.doc.size),
          toWorld(workspaceGeometry(s), event.clientX, event.clientY)
        )
        if (index >= 0 && shots[index].doc.sourceId === null) selectShot(shots[index].id)
      }
      void loadFiles(files, 'drop')
    }
    const unsavedCount = () => liveShots().filter(isUnsaved).length
    // Browser build: the browser's own "leave site?" prompt.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!bridge && unsavedCount() > 0) event.preventDefault()
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('beforeunload', onBeforeUnload)
    const offMenu = bridge?.onMenuCommand(runCommand)
    const offCancel = bridge?.onCaptureCancel(cancelCapture)
    const offFinished = bridge?.onRecordingFinished((result) => void finishRecording(result))
    const offFailed = bridge?.onRecordingFailed((error) => void recordingFailed(error))
    // Desktop: closing with shots that were never exported asks first.
    const offClose = bridge?.onCloseRequest(async () => {
      const count = unsavedCount()
      if (count === 0 || (await bridge!.confirmDiscard(count))) bridge!.closeWindow()
    })
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('beforeunload', onBeforeUnload)
      offMenu?.()
      offCancel?.()
      offFinished?.()
      offFailed?.()
      offClose?.()
    }
  }, [])

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-canvas font-sans text-(--tc-fg)">
      <Workspace />
      <CropBar />
      <SelectionBar />
      <Toolbar />
      <Timeline />
      <Panel />
      <CaptureDialog />
      <Toaster
        theme={theme}
        // Top of the canvas area, centered on it: the only spot no toolbar, crop bar or panel uses.
        position="top-left"
        offset={{ top: toastTop, left: toastLeft }}
        mobileOffset={{ top: toastTop, left: 16, right: 16 }}
        style={{ '--width': `${TOAST_WIDTH}px` } as CSSProperties}
        toastOptions={{
          style: {
            background: 'var(--tc-panel-solid)',
            color: 'var(--tc-fg)',
            border: '1px solid var(--tc-line)',
            fontSize: 13,
            fontFamily: 'inherit'
          }
        }}
      />
    </main>
  )
}
