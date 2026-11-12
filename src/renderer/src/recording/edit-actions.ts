import { toast } from 'sonner'
import { store, updateDoc } from '../app/store'
import { currentPlayhead, applyTimeMap } from './playback'
import { cutRange, pieceAt, restoreRange, samePieces, setRangeRate, splitAt } from './pieces'
import { timeMapOf, type Piece, type Rate, type Span } from './timemap'
import type { Trim } from './trim'

const TOO_LITTLE_LEFT_MESSAGE = 'Keep at least half a second of the recording'

/** The piece under `at`, within the trim. */
export function rangeAt(pieces: Piece[], trim: Trim, at: number): Span {
  const piece = pieceAt(pieces, at)
  return { start: Math.max(piece.start, trim.start), end: Math.min(piece.end, trim.end) }
}

const overlaps = (piece: Piece, range: Span) => piece.start < range.end && piece.end > range.start

export const rangeHasCut = (pieces: Piece[], range: Span): boolean => pieces.some((piece) => piece.cut && overlaps(piece, range))

/** The one rate of the pieces a range touches, or 'mixed' when they differ. */
export function rateOfRange(pieces: Piece[], range: Span): Rate | 'mixed' {
  const rates = new Set(pieces.filter((piece) => overlaps(piece, range)).map((piece) => piece.rate))
  return rates.size === 1 ? [...rates][0] : 'mixed'
}

export function selectRange(range: Span | null) {
  store.set({ timelineSelection: range ? { kind: 'range', start: range.start, end: range.end } : null })
}

function selectedRange(): Span | null {
  const { timelineSelection } = store.get()
  return timelineSelection?.kind === 'range' ? { start: timelineSelection.start, end: timelineSelection.end } : null
}

function merged(pieces: Piece[]): Piece[] {
  return pieces.reduce<Piece[]>((joined, piece) => {
    const previous = joined.at(-1)
    if (previous && previous.rate === piece.rate && previous.cut === piece.cut) previous.end = piece.end
    else joined.push({ ...piece })
    return joined
  }, [])
}

const playsTheSame = (a: Piece[], b: Piece[]) => samePieces(merged(a), merged(b))

function storePieces(pieces: Piece[], isUnchanged: (before: Piece[], after: Piece[]) => boolean) {
  const before = store.get().doc.recording?.pieces
  if (!before || isUnchanged(before, pieces)) return
  updateDoc((doc) => (doc.recording ? { recording: { ...doc.recording, pieces } } : {}))
  const recording = store.get().doc.recording
  if (recording) applyTimeMap(timeMapOf(recording.trim, recording.pieces), recording.trim)
}

/** Applies one edit of the pieces as one undo step, or refuses when it would leave under half a second. */
function editPieces(change: (recording: { pieces: Piece[]; trim: Trim }, range: Span) => Piece[] | null) {
  const recording = store.get().doc.recording
  const range = selectedRange()
  if (!recording || !range) return
  const changed = change(recording, range)
  if (changed === null) return void toast(TOO_LITTLE_LEFT_MESSAGE)
  storePieces(changed, playsTheSame)
}

export function splitAtPlayhead() {
  const recording = store.get().doc.recording
  if (!recording) return
  const at = currentPlayhead()
  if (at <= recording.trim.start || at >= recording.trim.end) return
  const split = splitAt(recording.pieces, at)
  storePieces(split, samePieces)
}

export function cutSelection() {
  editPieces(({ pieces, trim }, range) => cutRange(pieces, range, trim))
}

export function restoreSelection() {
  editPieces(({ pieces }, range) => restoreRange(pieces, range))
}

export function setSelectionRate(rate: Rate) {
  editPieces(({ pieces, trim }, range) => setRangeRate(pieces, range, rate, trim))
}
