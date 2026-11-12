import { RATES, timeMapOf, wholeTake, type Piece, type Rate, type Span } from './timemap'
import { TRIM_RULES, type Trim } from './trim'

export const MIN_PIECE_MS = 100

const isRate = (value: unknown): value is Rate => RATES.includes(value as Rate)

const isPieceLike = (value: unknown): value is { start: number; end: number; rate?: unknown; cut?: unknown } => {
  if (typeof value !== 'object' || value === null) return false
  const { start, end } = value as Record<string, unknown>
  return typeof start === 'number' && typeof end === 'number' && Number.isFinite(start) && Number.isFinite(end)
}

const takeLengthOf = (pieces: unknown[]) => Math.max(0, ...pieces.filter(isPieceLike).map((piece) => piece.end))

/** Ordered pieces tiling [0, durationMs] without gaps or overlaps; one whole-take piece when nothing can be repaired. */
export function validPieces(input: unknown, durationMs: number): Piece[] {
  const length = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  if (!Array.isArray(input)) return wholeTake(length)
  const candidates = input
    .filter(isPieceLike)
    .map((piece) => ({
      start: Math.max(0, piece.start),
      end: Math.min(length, piece.end),
      rate: isRate(piece.rate) ? piece.rate : (1 as Rate),
      cut: piece.cut === true
    }))
    .filter((piece) => piece.end > piece.start)
    .sort((a, b) => a.start - b.start)
  const tiled: Piece[] = []
  for (const candidate of candidates) {
    const previous = tiled.at(-1)
    if (!previous) {
      tiled.push({ ...candidate, start: 0 })
      continue
    }
    if (candidate.end <= previous.end) continue
    previous.end = Math.max(previous.end, candidate.start)
    tiled.push({ ...candidate, start: previous.end })
  }
  const last = tiled.at(-1)
  if (!last) return wholeTake(length)
  last.end = length
  return tiled
}

const samePiece = (a: Piece, b: Piece) => a.start === b.start && a.end === b.end && a.rate === b.rate && a.cut === b.cut

export const samePieces = (a: Piece[], b: Piece[]): boolean => a === b || (a.length === b.length && a.every((piece, i) => samePiece(piece, b[i])))

export function pieceAt(pieces: Piece[], at: number): Piece {
  if (pieces.length === 0) return wholeTake(0)[0]
  return pieces.find((piece) => at >= piece.start && at < piece.end) ?? (at < pieces[0].start ? pieces[0] : pieces[pieces.length - 1])
}

export function splitAt(pieces: Piece[], at: number): Piece[] {
  const tidy = validPieces(pieces, takeLengthOf(pieces))
  const piece = pieceAt(tidy, at)
  if (at - piece.start < MIN_PIECE_MS || piece.end - at < MIN_PIECE_MS) return tidy
  return tidy.flatMap((candidate) => (candidate === piece ? [{ ...piece, end: at }, { ...piece, start: at }] : [candidate]))
}

function snapToBoundary(pieces: Piece[], at: number): number {
  const boundaries = [...pieces.map((piece) => piece.start), takeLengthOf(pieces)]
  const nearest = boundaries.reduce((best, boundary) => (Math.abs(boundary - at) < Math.abs(best - at) ? boundary : best))
  return Math.abs(nearest - at) < MIN_PIECE_MS ? nearest : at
}

function editRange(pieces: Piece[], range: Span, change: (piece: Piece) => Piece): Piece[] {
  const tidy = validPieces(pieces, takeLengthOf(pieces))
  const length = takeLengthOf(tidy)
  const start = snapToBoundary(tidy, Math.max(0, Math.min(range.start, length)))
  const end = snapToBoundary(tidy, Math.max(0, Math.min(range.end, length)))
  if (end <= start) return tidy
  return splitAt(splitAt(tidy, start), end).map((piece) => (piece.start >= start && piece.end <= end ? change(piece) : piece))
}

/** The shortest output an edit may leave: half a second, or what the take already plays when that is shorter. */
export const outputFloor = (trim: Trim, pieces: Piece[]): number => Math.min(TRIM_RULES.minLengthMs, timeMapOf(trim, pieces).outputMs)

const keepsFloor = (before: Piece[], after: Piece[], trim: Trim) => timeMapOf(trim, after).outputMs >= outputFloor(trim, before)

export function cutRange(pieces: Piece[], range: Span, trim: Trim): Piece[] | null {
  const cut = editRange(pieces, range, (piece) => ({ ...piece, cut: true }))
  return keepsFloor(pieces, cut, trim) ? cut : null
}

export const restoreRange = (pieces: Piece[], range: Span): Piece[] => editRange(pieces, range, (piece) => ({ ...piece, cut: false }))

export function setRangeRate(pieces: Piece[], range: Span, rate: Rate, trim: Trim): Piece[] | null {
  const changed = editRange(pieces, range, (piece) => ({ ...piece, rate }))
  return keepsFloor(pieces, changed, trim) ? changed : null
}
