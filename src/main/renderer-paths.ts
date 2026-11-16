import { lstat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'

/** \\host\share, \\?\… and \\.\…, in either slash style. Touching one can reach the network and send the user's credentials. */
export const isUncOrDevicePath = (path: string) => /^[\\/]{2}/.test(path)

const IMAGE_EXTENSIONS = new Set(['.png', '.webp'])
const FALLBACK_IMAGE_STEM = 'cawmera-shot'

/** The path's root, each folder below it, then the path itself. */
function stepsDownTo(path: string): string[] {
  const steps = [path]
  for (let folder = dirname(path); folder !== steps[0]; folder = dirname(folder)) steps.unshift(folder)
  return steps
}

/**
 * What a path from the renderer names, checked before anything opens it: an absolute, local path with no link anywhere on the
 * way, since a symbolic link or a junction can lead to the network. libuv reports both as links, but not OneDrive's placeholders.
 * The path comes back resolved, as it was checked.
 */
async function localEntry(path: unknown): Promise<{ path: string; info: Stats } | null> {
  if (typeof path !== 'string' || isUncOrDevicePath(path) || !isAbsolute(path)) return null
  const resolved = resolve(path)
  if (isUncOrDevicePath(resolved)) return null
  let info: Stats | null = null
  for (const step of stepsDownTo(resolved)) {
    info = await lstat(step).catch(() => null)
    if (!info || info.isSymbolicLink()) return null
  }
  return info && { path: resolved, info }
}

/** A path from the renderer to open: a local file with this extension. */
export async function localFile(path: unknown, extension: string): Promise<string | null> {
  if (typeof path !== 'string' || extname(path).toLowerCase() !== extension) return null
  const entry = await localEntry(path)
  return entry?.info.isFile() ? entry.path : null
}

/** A path from the renderer to show in its folder: a local file or folder. */
export async function revealablePath(path: unknown): Promise<string | null> {
  return (await localEntry(path))?.path ?? null
}

/** Images from the renderer to save in one folder: PNG and WebP only, each under a file name of its own there. */
export function imagesToSave(images: unknown): { name: string; bytes: Uint8Array }[] {
  if (!Array.isArray(images)) return []
  const taken = new Set<string>()
  const files: { name: string; bytes: Uint8Array }[] = []
  for (const image of images) {
    const { name, bytes } = (typeof image === 'object' && image !== null ? image : {}) as Record<string, unknown>
    if (typeof name !== 'string' || !(bytes instanceof Uint8Array)) continue
    const ext = extname(name)
    if (!IMAGE_EXTENSIONS.has(ext.toLowerCase())) continue
    // Same names are allowed in the app; on disk the second one becomes name-2, and so on.
    const stem = basename(name, ext) || FALLBACK_IMAGE_STEM
    let candidate = `${stem}${ext}`
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`
    taken.add(candidate.toLowerCase())
    files.push({ name: candidate, bytes })
  }
  return files
}
