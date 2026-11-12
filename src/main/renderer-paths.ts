import { stat } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'

/** \\host\share, \\?\… and \\.\…, in either slash style. Touching one can reach the network and send the user's credentials. */
export const isUncOrDevicePath = (path: string) => /^[\\/]{2}/.test(path)

/** A path from the renderer, checked before anything opens it: an absolute, local file with this extension. */
export async function localFile(path: unknown, extension: string): Promise<string | null> {
  if (typeof path !== 'string' || isUncOrDevicePath(path) || !isAbsolute(path) || extname(path).toLowerCase() !== extension) return null
  const info = await stat(path).catch(() => null)
  return info?.isFile() ? path : null
}
