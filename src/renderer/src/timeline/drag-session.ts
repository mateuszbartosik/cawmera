export interface DragSession<T> {
  readonly isOpen: boolean
  begin(before: T): void
  /** Whether a pointer move belongs to the drag; a move with no button pressed ends it. */
  accepts(buttons: number): boolean
  end(): void
}

/** One drag, committed once as one undo step however it ends. */
export function dragSession<T>(commit: (before: T) => void): DragSession<T> {
  let before: { value: T } | null = null
  const session: DragSession<T> = {
    get isOpen() {
      return before !== null
    },
    begin(value) {
      before = { value }
    },
    accepts(buttons) {
      if (!before) return false
      if (buttons === 0) session.end()
      return before !== null
    },
    end() {
      if (!before) return
      const { value } = before
      before = null
      commit(value)
    }
  }
  return session
}
