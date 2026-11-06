export type ByteRange = { start: number; end: number }

/** `null` means the whole file is served. */
export function parseRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null
  if (!match || (match[1] === '' && match[2] === '')) return null
  if (size <= 0) return 'unsatisfiable'
  if (match[1] === '') {
    const length = Number(match[2])
    return length === 0 ? 'unsatisfiable' : { start: Math.max(0, size - length), end: size - 1 }
  }
  const start = Number(match[1])
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  return start >= size || start > end ? 'unsatisfiable' : { start, end }
}
