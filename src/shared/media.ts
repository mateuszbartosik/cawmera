export const MEDIA_SCHEME = 'cawmera-media'

const RECORDING_URL = new RegExp(`^${MEDIA_SCHEME}://recording/([^/?#]+)/?$`)

export const recordingUrl = (id: string) => `${MEDIA_SCHEME}://recording/${id}`

export const recordingIdFromUrl = (url: string): string | null => RECORDING_URL.exec(url)?.[1] ?? null
