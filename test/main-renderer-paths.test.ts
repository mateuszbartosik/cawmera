import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { isUncOrDevicePath, localFile } from '../src/main/renderer-paths'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    stat: vi.fn(async (path: string) => {
      if (/^[\\/]{2}/.test(path)) throw new Error('The test reached for the network')
      return actual.stat(path)
    })
  }
})

const tempDirs: string[] = []

afterAll(() => Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3 }))))

const NETWORK_AND_DEVICE_PATHS = [
  '\\\\attacker\\share\\x.cawmera',
  '//attacker/share/x.cawmera',
  '\\/attacker/share/x.cawmera',
  '/\\attacker\\share\\x.cawmera',
  '\\\\attacker@SSL\\DavWWWRoot\\x.cawmera',
  '\\\\?\\UNC\\attacker\\share\\x.cawmera',
  '\\\\?\\C:\\drafts\\x.cawmera',
  '\\\\.\\pipe\\x.cawmera',
  '//./pipe/x.cawmera'
]

describe('paths the renderer names', () => {
  it('refuses UNC and device paths in either slash style, before touching the file system', async () => {
    vi.mocked(stat).mockClear()
    for (const path of NETWORK_AND_DEVICE_PATHS) {
      expect(isUncOrDevicePath(path)).toBe(true)
      expect(await localFile(path, '.cawmera')).toBeNull()
    }
    expect(stat).not.toHaveBeenCalled()
    for (const path of ['C:\\drafts\\x.cawmera', 'C:/drafts/x.cawmera', '\\drafts\\x.cawmera', '/home/someone/x.cawmera']) {
      expect(isUncOrDevicePath(path)).toBe(false)
    }
  })

  it('takes an absolute path to a local file with the extension, and nothing else', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cawmera-paths-'))
    tempDirs.push(dir)
    const draft = join(dir, 'a.cawmera')
    const shouting = join(dir, 'B.CAWMERA')
    const notes = join(dir, 'notes.txt')
    const folder = join(dir, 'folder.cawmera')
    for (const file of [draft, shouting, notes]) await writeFile(file, 'x')
    await mkdir(folder)
    expect(await localFile(draft, '.cawmera')).toBe(draft)
    expect(await localFile(shouting, '.cawmera')).toBe(shouting)
    for (const refused of [notes, folder, join(dir, 'missing.cawmera'), 'a.cawmera', '', 42, null]) {
      expect(await localFile(refused, '.cawmera')).toBeNull()
    }
  })
})
