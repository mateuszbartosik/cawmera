import { lstat, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { imagesToSave, isUncOrDevicePath, localFile, revealablePath } from '../src/main/renderer-paths'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const refuseTheNetwork = (path: string) => {
    if (/^[\\/]{2}/.test(path)) throw new Error('The test reached for the network')
  }
  return {
    ...actual,
    stat: vi.fn(async (path: string) => {
      refuseTheNetwork(path)
      return actual.stat(path)
    }),
    lstat: vi.fn(async (path: string) => {
      refuseTheNetwork(path)
      return actual.lstat(path)
    })
  }
})

const tempDirs: string[] = []

afterAll(() => Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3 }))))

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'cawmera-paths-'))
  tempDirs.push(dir)
  return dir
}

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

/** A folder with a draft in it, a junction to that folder, and a draft one folder further down it. */
async function linkedFolders() {
  const dir = await tempDir()
  const real = join(dir, 'real')
  await mkdir(join(real, 'deeper'), { recursive: true })
  for (const draft of [join(real, 'a.cawmera'), join(real, 'deeper', 'b.cawmera')]) await writeFile(draft, 'x')
  const junction = join(dir, 'junction')
  await symlink(real, junction, 'junction')
  return { dir, real, junction }
}

/** Creating a symbolic link to a file needs Developer Mode or an elevated prompt on Windows; without either, there's nothing to test. */
async function fileLink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path, 'file')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return false
    throw error
  }
}

describe('paths the renderer names', () => {
  it('refuses UNC and device paths in either slash style, before touching the file system', async () => {
    vi.mocked(stat).mockClear()
    vi.mocked(lstat).mockClear()
    for (const path of NETWORK_AND_DEVICE_PATHS) {
      expect(isUncOrDevicePath(path)).toBe(true)
      expect(await localFile(path, '.cawmera')).toBeNull()
      expect(await revealablePath(path)).toBeNull()
    }
    expect(stat).not.toHaveBeenCalled()
    expect(lstat).not.toHaveBeenCalled()
    for (const path of ['C:\\drafts\\x.cawmera', 'C:/drafts/x.cawmera', '\\drafts\\x.cawmera', '/home/someone/x.cawmera']) {
      expect(isUncOrDevicePath(path)).toBe(false)
    }
  })

  it('takes an absolute path to a local file with the extension, and nothing else', async () => {
    const dir = await tempDir()
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

  it('refuses a draft with a junction anywhere on the way, since one can lead to the network', async () => {
    const { real, junction } = await linkedFolders()
    expect(await localFile(join(real, 'a.cawmera'), '.cawmera')).toBe(join(real, 'a.cawmera'))
    expect(await localFile(join(real, 'deeper', 'b.cawmera'), '.cawmera')).toBe(join(real, 'deeper', 'b.cawmera'))
    expect(await localFile(join(junction, 'a.cawmera'), '.cawmera')).toBeNull()
    expect(await localFile(join(junction, 'deeper', 'b.cawmera'), '.cawmera')).toBeNull()
  })

  it('refuses a draft that is a symbolic link itself', async () => {
    const { dir, real } = await linkedFolders()
    const link = join(dir, 'link.cawmera')
    if (!(await fileLink(join(real, 'a.cawmera'), link))) return
    expect(await localFile(link, '.cawmera')).toBeNull()
  })

  it('opens the path it checked, with any “..” resolved', async () => {
    const { real } = await linkedFolders()
    const roundabout = [real, 'deeper', '..', 'a.cawmera'].join(sep)
    expect(await localFile(roundabout, '.cawmera')).toBe(join(real, 'a.cawmera'))
  })

  it('reveals a local file or folder with no link on the way, and nothing else', async () => {
    const { dir, real, junction } = await linkedFolders()
    expect(await revealablePath(join(real, 'a.cawmera'))).toBe(join(real, 'a.cawmera'))
    expect(await revealablePath(real)).toBe(real)
    for (const refused of [join(junction, 'a.cawmera'), junction, join(dir, 'missing.png'), 'a.png', '', 7, null]) {
      expect(await revealablePath(refused)).toBeNull()
    }
  })
})

describe('images the renderer hands over to save', () => {
  const bytes = new Uint8Array([1, 2, 3])

  it('saves PNG and WebP only, each under a name of its own in the folder', () => {
    const images = [
      { name: 'billing.png', bytes },
      { name: 'Billing.PNG', bytes },
      { name: 'billing.webp', bytes },
      { name: 'evil.url', bytes },
      { name: 'shortcut.lnk', bytes },
      { name: 'page.html', bytes },
      { name: 'no-extension', bytes },
      { name: 'trailing.png.', bytes },
      { name: 'stream.png:hidden', bytes },
      { name: '..\\..\\escape.png', bytes },
      { name: 'some/folder/nested.webp', bytes },
      { name: 7, bytes },
      { name: 'no-bytes.png' },
      null
    ]
    expect(imagesToSave(images)).toEqual(
      ['billing.png', 'Billing-2.PNG', 'billing.webp', 'escape.png', 'nested.webp'].map((name) => ({ name, bytes }))
    )
  })

  it('takes nothing that isn’t a list', () => {
    for (const notAList of [null, undefined, 'images', { name: 'a.png', bytes }, 7]) expect(imagesToSave(notAList)).toEqual([])
  })
})
