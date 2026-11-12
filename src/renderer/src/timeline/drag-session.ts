import { useEffect, useState } from 'react'
import { beginGesture, cancelGesture, endGesture, isGestureOpen, type Gesture } from '../app/store'

export interface DragSession {
  /** False once it has ended, or once the store committed it early: switching shots, Undo, Redo or an edit with history. */
  readonly isOpen: boolean
  begin(): void
  /** Whether a pointer move belongs to the drag; a move with no button pressed ends it. */
  accepts(buttons: number): boolean
  /** A slider’s or a key’s change: the first one begins the session, and once the store has committed it, none edits until it ends. */
  edit(change: () => void): void
  /** Ends it with no undo step, putting the shot back as it was. */
  cancel(): void
  end(): void
}

/** One drag, or one run of slider or key changes, as one undo step in the shot it began on, however it ends. */
export function dragSession(): DragSession {
  let gesture: Gesture | null = null
  const session: DragSession = {
    get isOpen() {
      return gesture !== null && isGestureOpen(gesture)
    },
    begin() {
      gesture = beginGesture()
    },
    accepts(buttons) {
      if (buttons === 0) session.end()
      return session.isOpen
    },
    edit(change) {
      if (gesture === null) session.begin()
      if (session.isOpen) change()
    },
    cancel() {
      if (gesture) cancelGesture(gesture)
      gesture = null
    },
    end() {
      if (gesture) endGesture(gesture)
      gesture = null
    }
  }
  return session
}

/** A component’s session, ended if the component goes mid-drag. */
export function useDragSession(): DragSession {
  const [session] = useState(dragSession)
  useEffect(() => () => session.end(), [session])
  return session
}
