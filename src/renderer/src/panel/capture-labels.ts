import type { CaptureDelay, CaptureMode, CaptureState } from '../app/store'

export const captureDialogTitle = (mode: CaptureMode) => (mode === 'recording' ? 'Record' : 'Screenshot')

export const captureDelayNote = (mode: CaptureMode, delay: CaptureDelay) => `${mode === 'recording' ? 'Starts' : 'Captures'} ${delay} s after you pick`

export function screenshotButtonLabel({ phase, remaining }: CaptureState): string {
  if (phase === 'countdown') return `In ${remaining}…`
  if (phase === 'grabbing') return 'Capturing…'
  if (phase === 'picking') return 'Picking…'
  return 'Screenshot'
}
