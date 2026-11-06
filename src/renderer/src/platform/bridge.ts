import type { CawmeraBridge, ImageFormat } from '@shared/types'
import { snapDensity, type Density } from '../app/doc'

declare global {
  interface Window {
    cawmera?: CawmeraBridge
  }
}

/** Present in the Electron app; absent in the browser build, which falls back to web APIs. */
export const bridge: CawmeraBridge | null = typeof window !== 'undefined' ? (window.cawmera ?? null) : null
export const isDesktop = bridge !== null

/** A screenshot taken on this screen has this screen's density, so it is the best default. */
export function displayDensity(): Density {
  const zoom = bridge?.zoomFactor() ?? 1
  return snapDensity(window.devicePixelRatio / (zoom || 1))
}

export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Saves one image. Desktop: native save dialog, remembering the folder. Browser: a download. */
export async function saveImage(blob: Blob, fileName: string, format: ImageFormat): Promise<{ path: string | null } | null> {
  if (bridge) {
    const result = await bridge.saveImage(await blobBytes(blob), fileName, format)
    return result ? { path: result.path } : null
  }
  download(blob, fileName)
  return { path: null }
}

/** Saves one video. Desktop: native save dialog, remembering the folder. Browser: a download. */
export async function saveVideo(blob: Blob, fileName: string): Promise<{ path: string | null } | null> {
  if (bridge) {
    const result = await bridge.saveVideo(await blobBytes(blob), fileName)
    return result ? { path: result.path } : null
  }
  download(blob, fileName)
  return { path: null }
}

/** Saves several images. Desktop: pick a folder once. Browser: one download each. */
export async function saveImages(images: { name: string; blob: Blob }[]): Promise<{ folder: string | null; count: number } | null> {
  if (bridge) {
    const payload = await Promise.all(images.map(async (image) => ({ name: image.name, bytes: await blobBytes(image.blob) })))
    const result = await bridge.saveImages(payload)
    return result ? { folder: result.folder, count: result.paths.length } : null
  }
  for (const image of images) {
    download(image.blob, image.name)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return { folder: null, count: images.length }
}

export async function copyPng(blob: Blob): Promise<void> {
  if (bridge) {
    await bridge.copyPng(await blobBytes(blob))
    return
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

/** Some clipboard formats (e.g. bitmaps from older Windows tools) never reach the web paste event. */
export async function readClipboardImageFallback(): Promise<Blob | null> {
  if (bridge) {
    const bytes = await bridge.readClipboardImage()
    return bytes ? new Blob([bytes as BlobPart], { type: 'image/png' }) : null
  }
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'))
      if (type) return await item.getType(type)
    }
  } catch {
    /* permission denied or unsupported */
  }
  return null
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Reads one current frame from a capture stream. */
export async function grabFrame(stream: MediaStream): Promise<ImageBitmap> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  await video.play()
  // Wait for a frame that was produced after this call, but don't hang on a static screen.
  await Promise.race([
    new Promise<void>((resolve) => {
      if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(() => resolve())
      else setTimeout(resolve, 120)
    }),
    wait(700)
  ])
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) throw new Error('The capture produced no frame')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is unavailable')
  ctx.drawImage(video, 0, 0, width, height)
  video.pause()
  video.srcObject = null
  return await createImageBitmap(canvas)
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}
