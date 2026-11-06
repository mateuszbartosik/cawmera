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

export interface MediaReply {
  status: number
  headers: Record<string, string>
  range: ByteRange | null
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length'
}

/** Status and headers for a media request; `size` is null when the file does not exist. `range` is the byte span of the body, if any. */
export function mediaReply(method: string, rangeHeader: string | null, size: number | null): MediaReply {
  if (method === 'OPTIONS') {
    const preflight = { ...CORS_HEADERS, 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': 'Range' }
    return { status: 204, headers: preflight, range: null }
  }
  if (size === null) return { status: 404, headers: { ...CORS_HEADERS }, range: null }
  const requested = parseRange(rangeHeader, size)
  if (requested === 'unsatisfiable') {
    return { status: 416, headers: { ...CORS_HEADERS, 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' }, range: null }
  }
  const span = requested ?? { start: 0, end: size - 1 }
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(size === 0 ? 0 : span.end - span.start + 1)
  }
  if (requested) headers['Content-Range'] = `bytes ${span.start}-${span.end}/${size}`
  return { status: requested ? 206 : 200, headers, range: size === 0 ? null : span }
}
