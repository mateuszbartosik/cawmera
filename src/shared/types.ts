/** Contract between the Electron main process (via preload) and the renderer. */

export interface CaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  /** PNG data URL, small preview for the picker ('' when the OS gave none). */
  thumbnail: string
  appIcon: string | null
  /** Pixel density of the display the source lives on (best effort for windows). */
  scaleFactor: number
  /** Display a screen source shows; null for windows. */
  displayId: string | null
}

/** On-screen countdown shown while a delayed capture waits. */
export interface CountdownRequest {
  /** Display to show it on; null = the one under the pointer (window captures). */
  displayId: string | null
  seconds: number
  /** The shot's light colour (#RRGGBB), so the countdown matches the house style. */
  color?: string
}

export type ImageFormat = 'webp' | 'png'

export interface NamedImage {
  name: string
  bytes: Uint8Array
}

export type MenuCommand =
  | 'open'
  | 'capture'
  | 'new-shot'
  | 'next-shot'
  | 'previous-shot'
  | 'export'
  | 'export-all'
  | 'copy'
  | 'undo'
  | 'redo'
  | 'fit'
  | 'fit-shot'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-100'
  | 'toggle-theme'
  | 'toggle-house-style'
  | 'about'

export type RecordingUnavailableReason = 'platform' | 'windows-version' | 'helper-missing'

export type RecordingSupport = { ok: true } | { ok: false; reason: RecordingUnavailableReason }

export type RecordingErrorCode = 'unsupported' | 'access-denied' | 'target-gone' | 'encoder' | 'internal' | 'timeout' | 'cancelled'

export interface RecordingError {
  code: RecordingErrorCode
  message: string
  reason?: RecordingUnavailableReason
}

export interface RecordingStartRequest {
  sourceId: string
  displayId: string | null
}

export interface RecordingFinished {
  id: string
  stoppedBy: 'shortcut' | 'window' | 'target-gone'
  /** The helper's track.json, unparsed. */
  track: string
}

/** A draft's contents by key. A recording's `id` names its take: the one to copy when saving, the new one when opening. */
export interface DraftFiles {
  manifest: string
  screenshots: { key: string; bytes: Uint8Array }[]
  recordings: { key: string; id: string; track: string }[]
}

export type DraftOpenFailure = 'not-a-draft' | 'damaged' | 'too-large' | 'unreadable'

export type DraftOpenResult = { ok: true; files: DraftFiles } | { ok: false; reason: DraftOpenFailure; message: string }

export interface CawmeraBridge {
  readonly platform: string
  getVersion(): Promise<string>
  listCaptureSources(): Promise<CaptureSource[]>
  /** Arms the next getDisplayMedia() call with this source (no system picker). */
  prepareCapture(sourceId: string): Promise<boolean>
  hideWindow(): Promise<void>
  restoreWindow(): Promise<void>
  /** Taskbar / dock progress, 0..1. A negative value clears it. */
  setProgress(value: number): void
  /** Shows the countdown on screen. It never takes focus, so a menu opened during the delay stays open. */
  showCountdown(request: CountdownRequest): Promise<void>
  tickCountdown(remaining: number): void
  /** Removes the countdown and waits until the screen no longer shows it. */
  hideCountdown(): Promise<void>
  /** Cancel pressed on the on-screen countdown. */
  onCaptureCancel(listener: () => void): () => void
  /** Save dialog for one image; remembers the folder. */
  saveImage(bytes: Uint8Array, suggestedName: string, format: ImageFormat): Promise<{ path: string } | null>
  /** Folder picker, then writes every image (names made unique). */
  saveImages(images: NamedImage[]): Promise<{ folder: string; paths: string[] } | null>
  /** Clipboard images are always PNG. */
  copyPng(bytes: Uint8Array): Promise<void>
  readClipboardImage(): Promise<Uint8Array | null>
  revealFile(path: string): Promise<void>
  recordingSupport(): Promise<RecordingSupport>
  /** Warms the recorder up on the source; resolves with null once it is ready (nothing is recorded yet), or why it could not start. */
  startRecording(request: RecordingStartRequest): Promise<RecordingError | null>
  /** Starts a warmed-up recording (after the countdown). Resolves with an error if the target went away meanwhile. */
  beginRecording(): Promise<RecordingError | null>
  /** Before beginRecording() this cancels the take and a pending startRecording() resolves `cancelled`. */
  stopRecording(): Promise<void>
  onRecordingFinished(listener: (result: RecordingFinished) => void): () => void
  onRecordingFailed(listener: (error: RecordingError) => void): () => void
  saveVideo(bytes: Uint8Array, suggestedName: string): Promise<{ path: string } | null>
  /** Save dialog, then writes the draft, copying each recording's video from its take. Null when cancelled. */
  saveDraft(files: DraftFiles, suggestedName: string): Promise<{ path: string } | { error: string } | null>
  /** Opens the draft at `path`, or asks for one when it's null. Null when cancelled. */
  openDraft(path: string | null): Promise<DraftOpenResult | null>
  /** Share of the draft written or read so far, 0..1. */
  onDraftProgress(listener: (share: number) => void): () => void
  /** Where a dropped or picked file lives on disk; '' when it has no path. */
  pathForFile(file: File): string
  setNativeTheme(theme: 'dark' | 'light'): void
  zoomFactor(): number
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
  /** The window wants to close; answer with closeWindow() or keep it open. */
  onCloseRequest(listener: () => void): () => void
  /** Native "discard unsaved shots?" dialog. */
  confirmDiscard(unsavedCount: number): Promise<boolean>
  closeWindow(): void
}
