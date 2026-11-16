import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HouseStyle } from '../src/renderer/src/app/house-style'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

const STYLE_KEY = 'cawmera.houseStyle.v1'
const STYLE_IMAGE_KEY = 'cawmera.houseStyleImage.v1'
const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key)
})

/** Fake images carry their size where a PNG does. A body byte of UNDECODABLE makes one whose size reads but whose pixels won't decode. */
const UNDECODABLE = 0xff
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]

const dataUrl = (bytes: Uint8Array) => `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`

function pngUrl(width: number, height: number, body = 0): string {
  const bytes = new Uint8Array(25)
  bytes.set(PNG_HEADER)
  const header = new DataView(bytes.buffer)
  header.setUint32(16, width)
  header.setUint32(20, height)
  bytes[24] = body
  return dataUrl(bytes)
}

const NOT_AN_IMAGE = dataUrl(new TextEncoder().encode('not an image at all'))

let urlCount = 0
const liveUrls = new Map<string, Blob>()
vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
  urlCount += 1
  const url = `blob:backdrop-test/${urlCount}`
  liveUrls.set(url, blob as Blob)
  return url
})
vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => void liveUrls.delete(url))

async function sizeIn(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length < 25 || PNG_HEADER.some((byte, index) => bytes[index] !== byte)) return null
  const header = new DataView(bytes.buffer)
  return { width: header.getUint32(16), height: header.getUint32(20), body: bytes[24] }
}

/** Like the browser's, it reads only the size the image declares: its pixels are decoded by createImageBitmap alone. */
class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 0
  naturalHeight = 0
  set src(url: string) {
    const blob = liveUrls.get(url)
    void (blob ? sizeIn(blob) : Promise.resolve(null)).then((size) => {
      if (!size) return this.onerror?.()
      this.naturalWidth = size.width
      this.naturalHeight = size.height
      this.onload?.()
    })
  }
}
vi.stubGlobal('Image', FakeImage)

const decodeImage = vi.fn(async (blob: Blob) => {
  const size = await sizeIn(blob)
  if (!size || size.body === UNDECODABLE) throw new Error('The source image could not be decoded')
  return { width: size.width, height: size.height, close: vi.fn() } as unknown as ImageBitmap
})
vi.stubGlobal('createImageBitmap', decodeImage)

const { BACKDROP_MAX_SIDE, decodeBackdrop } = await import('../src/renderer/src/app/backdrop')
const { DEFAULT_HOUSE_STYLE, serializeHouseStyle } = await import('../src/renderer/src/app/house-style')
const { importHouseStyleFile } = await import('../src/renderer/src/app/actions')
const { backdropReady, replaceCanvas, store } = await import('../src/renderer/src/app/store')
const { DEFAULT_DOC } = await import('../src/renderer/src/app/doc')

const brand: HouseStyle = { ...DEFAULT_HOUSE_STYLE, name: 'Brand', plateFrom: '#112233', radius: 30 }
const styleFile = (backgroundImage: string) => new File([JSON.stringify(serializeHouseStyle({ ...brand, backgroundImage }))], 'brand.json')
const withoutImage = (style: HouseStyle) => ({ ...style, backgroundImage: null })

beforeEach(async () => {
  store.set({ style: DEFAULT_HOUSE_STYLE })
  await backdropReady()
  decodeImage.mockClear()
})

describe('a house style’s background image', () => {
  it('is refused before decoding when a side is over 4000 px', async () => {
    expect(BACKDROP_MAX_SIDE).toBe(4000)
    for (const [width, height] of [[23_000, 23_000], [4001, 10], [10, 4001]]) await expect(decodeBackdrop(pngUrl(width, height))).rejects.toThrow()
    expect(decodeImage).not.toHaveBeenCalled()
    expect(liveUrls.size).toBe(0)
  })

  it('is decoded when it fits, up to 4000 px a side', async () => {
    const bitmap = await decodeBackdrop(pngUrl(4000, 2500))
    expect([bitmap.width, bitmap.height]).toEqual([4000, 2500])
    expect(liveUrls.size).toBe(0)
  })

  it('is refused when its size can’t be read, or its pixels won’t decode', async () => {
    await expect(decodeBackdrop(NOT_AN_IMAGE)).rejects.toThrow()
    expect(decodeImage).not.toHaveBeenCalled()
    await expect(decodeBackdrop(pngUrl(800, 600, UNDECODABLE))).rejects.toThrow('could not be decoded')
  })

  it.each([
    ['too large', pngUrl(23_000, 23_000)],
    ['unreadable', NOT_AN_IMAGE],
    ['undecodable', pngUrl(800, 600, UNDECODABLE)]
  ])('is dropped when %s in an imported style, which applies otherwise', async (_, image) => {
    await importHouseStyleFile(styleFile(image))
    await backdropReady()
    expect(store.get().style).toEqual(withoutImage(brand))
    expect(store.get().backdrop).toBeNull()
    expect(stored.has(STYLE_IMAGE_KEY)).toBe(false)
    expect(JSON.parse(stored.get(STYLE_KEY)!)).toMatchObject({ name: 'Brand', radius: 30, backgroundImage: null })
  })

  it('stays in an imported style when it fits', async () => {
    const image = pngUrl(1600, 1000)
    await importHouseStyleFile(styleFile(image))
    await backdropReady()
    expect(store.get().style.backgroundImage).toBe(image)
    expect(store.get().backdrop).toMatchObject({ url: image, bitmap: { width: 1600, height: 1000 } })
    expect(stored.get(STYLE_IMAGE_KEY)).toBe(image)
  })

  it('is dropped from the style of an opened draft when it’s too large', async () => {
    const shot = { id: 'opened', defaultName: 'brave-otter-fig', doc: DEFAULT_DOC, past: [], future: [], savedDoc: null, draftDoc: null }
    replaceCanvas([shot], 0, { ...brand, backgroundImage: pngUrl(16_000, 9000) })
    await backdropReady()
    expect(store.get().style).toEqual(withoutImage(brand))
    expect(decodeImage).not.toHaveBeenCalled()
  })

  it('is checked the same way at launch when one was stored, and dropped from storage when too large', async () => {
    stored.set(STYLE_KEY, JSON.stringify(serializeHouseStyle(withoutImage(brand))))
    stored.set(STYLE_IMAGE_KEY, pngUrl(23_000, 23_000))
    vi.resetModules()
    const launched = await import('../src/renderer/src/app/store')
    await launched.backdropReady()
    expect(launched.store.get().style).toEqual(withoutImage(brand))
    expect(stored.has(STYLE_IMAGE_KEY)).toBe(false)
    expect(decodeImage).not.toHaveBeenCalled()
  })

  it('stays at launch when the stored one fits', async () => {
    const image = pngUrl(1200, 800)
    stored.set(STYLE_KEY, JSON.stringify(serializeHouseStyle(withoutImage(brand))))
    stored.set(STYLE_IMAGE_KEY, image)
    vi.resetModules()
    const launched = await import('../src/renderer/src/app/store')
    await launched.backdropReady()
    expect(launched.store.get().style.backgroundImage).toBe(image)
    expect(launched.store.get().backdrop?.bitmap).toMatchObject({ width: 1200, height: 800 })
  })
})
