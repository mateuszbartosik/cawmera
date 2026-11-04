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
  setNativeTheme(theme: 'dark' | 'light'): void
  zoomFactor(): number
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
  /** The window wants to close; answer with closeWindow() or keep it open. */
  onCloseRequest(listener: () => void): () => void
  /** Native "discard unsaved shots?" dialog. */
  confirmDiscard(unsavedCount: number): Promise<boolean>
  closeWindow(): void
}
