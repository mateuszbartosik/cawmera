import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { MEDIA_SCHEME, recordingIdFromUrl } from '../shared/media'
import { parseRange } from './range'

/** Must run before the app is ready. */
export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
  ])
}

const plain = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers })

export function registerMediaProtocol(videoFileFor: (id: string) => string | null) {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const id = recordingIdFromUrl(request.url)
    const file = id ? videoFileFor(id) : null
    if (!file) return plain(404)
    const size = await stat(file).then(
      (info) => info.size,
      () => null
    )
    if (size === null) return plain(404)

    const range = parseRange(request.headers.get('range'), size)
    if (range === 'unsatisfiable') return plain(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' })
    const { start, end } = range ?? { start: 0, end: size - 1 }
    const headers: Record<string, string> = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1)
    }
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    const status = range ? 206 : 200
    if (request.method === 'HEAD' || size === 0) return plain(status, headers)
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, { status, headers })
  })
}
