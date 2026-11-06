import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { MEDIA_SCHEME, recordingIdFromUrl } from '../shared/media'
import { mediaReply } from './range'

/** Must run before the app is ready. The renderer page is cross-origin to this scheme, hence corsEnabled. */
export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
  ])
}

export function registerMediaProtocol(videoFileFor: (id: string) => string | null) {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const id = recordingIdFromUrl(request.url)
    const file = id ? videoFileFor(id) : null
    const size = file
      ? await stat(file).then(
          (info) => info.size,
          () => null
        )
      : null
    const reply = mediaReply(request.method, request.headers.get('range'), size)
    const hasBody = file && reply.range && request.method !== 'HEAD'
    const body = hasBody ? (Readable.toWeb(createReadStream(file, reply.range!)) as ReadableStream) : null
    return new Response(body, { status: reply.status, headers: reply.headers })
  })
}
