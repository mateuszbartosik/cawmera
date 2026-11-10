export type SpaceTapEvent =
  | { kind: 'down'; repeat: boolean; typing: boolean; modified: boolean }
  | { kind: 'panStarted' }
  | { kind: 'up'; typing: boolean; modified: boolean; playable: boolean }

export interface SpaceTapStep { armed: boolean; toggle: boolean }

/** Tapping Space plays and pauses; a repeat, a pan, typing or a modifier makes it something else. */
export function stepSpaceTap(armed: boolean, event: SpaceTapEvent): SpaceTapStep {
  switch (event.kind) {
    case 'down':
      return { armed: !event.repeat && !event.typing && !event.modified, toggle: false }
    case 'panStarted':
      return { armed: false, toggle: false }
    case 'up':
      return { armed: false, toggle: armed && event.playable && !event.typing && !event.modified }
  }
}
