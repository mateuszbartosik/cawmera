import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } from 'mediabunny'
import type { Click, CursorSample, RecordingTrack } from '../src/renderer/src/recording/track'

export interface FixtureOptions { seconds: number; width: number; height: number; fps: number }

const MS_PER_SECOND = 1000
const CURSOR_SAMPLE_MS = 8
const CLICK_PRESS_MS = 90
const MOVE_SHARE_OF_GAP = 0.6
const MOVING_WINDOW_MS = 100
const MOVING_WINDOW_PX = 2
const FILLER_GAP_MS = 1500
const FILLER_CLEARANCE_MS = 1300
const KEY_FRAME_SECONDS = 2
const REFERENCE_WIDTH = 2560

interface Waypoint { t: number; x: number; y: number; click: boolean }

const CLICK_GROUPS = [
  { at: 0.2, anchor: { x: 0.74, y: 0.3 }, offsets: [{ x: 0, y: 0, after: -700 }, { x: -180, y: 90, after: 0 }, { x: 120, y: 190, after: 800 }] },
  { at: 0.5, anchor: { x: 0.28, y: 0.7 }, offsets: [{ x: -450, y: -80, after: -600 }, { x: 60, y: 60, after: 100 }, { x: 480, y: -40, after: 900 }] },
  { at: 0.78, anchor: { x: 0.62, y: 0.82 }, offsets: [{ x: -100, y: 0, after: -800 }, { x: 140, y: -120, after: 0 }, { x: -20, y: -190, after: 700 }] }
]

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

const onSampleGrid = (ms: number) => Math.round(ms / CURSOR_SAMPLE_MS) * CURSOR_SAMPLE_MS

function waypointsOf(options: FixtureOptions): Waypoint[] {
  const { seconds, width, height } = options
  const durationMs = seconds * MS_PER_SECOND
  const random = seededRandom(20261109)
  const clicks: Waypoint[] = CLICK_GROUPS.flatMap((group) =>
    group.offsets.map((offset) => ({
      t: onSampleGrid(group.at * durationMs + offset.after),
      x: Math.round(group.anchor.x * width + offset.x * (width / REFERENCE_WIDTH)),
      y: Math.round(group.anchor.y * height + offset.y * (width / REFERENCE_WIDTH)),
      click: true
    })))
  const fillers: Waypoint[] = []
  for (let t = FILLER_GAP_MS / 2; t < durationMs - FILLER_GAP_MS / 2; t += FILLER_GAP_MS * (0.7 + 0.6 * random())) {
    const nearClick = clicks.some((click) => Math.abs(click.t - t) < FILLER_CLEARANCE_MS)
    const x = Math.round(width * (0.08 + 0.84 * random()))
    const y = Math.round(height * (0.1 + 0.8 * random()))
    if (!nearClick) fillers.push({ t: onSampleGrid(t), x, y, click: false })
  }
  const start: Waypoint = { t: 0, x: Math.round(width / 2), y: Math.round(height / 2), click: false }
  return [start, ...fillers, ...clicks].sort((a, b) => a.t - b.t)
}

const smootherstep = (share: number) => share * share * share * (share * (share * 6 - 15) + 10)

function positionAt(waypoints: Waypoint[], t: number): { x: number; y: number } {
  const next = waypoints.findIndex((waypoint) => waypoint.t >= t)
  if (next <= 0) return waypoints[Math.max(next, 0)]
  const from = waypoints[next - 1]
  const to = waypoints[next]
  const moveMs = (to.t - from.t) * MOVE_SHARE_OF_GAP
  const share = Math.min(Math.max((t - (to.t - moveMs)) / moveMs, 0), 1)
  const eased = smootherstep(share)
  return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased }
}

/** A take of three click groups with a cursor that glides between rests, the same every time. */
export function syntheticTake(options: FixtureOptions): RecordingTrack {
  const { seconds, width, height, fps } = options
  const durationMs = seconds * MS_PER_SECOND
  const waypoints = waypointsOf(options)
  const clickAt = new Set(waypoints.filter((waypoint) => waypoint.click).map((waypoint) => waypoint.t))
  const cursor: CursorSample[] = []
  for (let t = 0; t <= durationMs; t += CURSOR_SAMPLE_MS) {
    const { x, y } = positionAt(waypoints, t)
    cursor.push({ t, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, shape: clickAt.has(t) ? 'hand' : 'arrow' })
  }
  const clicks: Click[] = waypoints
    .filter((waypoint) => waypoint.click)
    .map((waypoint) => ({ t: waypoint.t, x: waypoint.x, y: waypoint.y, button: 'left', up: waypoint.t + CLICK_PRESS_MS }))
  return { kind: 'monitor', width, height, fps, durationMs, scale: 1, cursor, clicks }
}

/** The share of 100 ms windows in which the cursor travels at least 2 px. */
export function movingShare(track: RecordingTrack): number {
  const windowCount = Math.floor(track.durationMs / MOVING_WINDOW_MS)
  let moving = 0
  for (let window = 0; window < windowCount; window++) {
    const inWindow = track.cursor.filter((sample) => sample.t >= window * MOVING_WINDOW_MS && sample.t <= (window + 1) * MOVING_WINDOW_MS)
    const first = inWindow[0]
    if (inWindow.some((sample) => Math.hypot(sample.x - first.x, sample.y - first.y) >= MOVING_WINDOW_PX)) moving++
  }
  return moving / windowCount
}

export const realtimeFactor = (clipMs: number, exportMs: number): number => exportMs / clipMs

const WORDS = ['Invoice', 'Subscription', 'Renewal', 'Customer', 'License', 'Statement', 'Payment', 'Contract', 'Account', 'Quote', 'Usage', 'Credit']
const NAMES = ['Northwind Traders', 'Contoso Ltd', 'Fabrikam Inc', 'Adventure Works', 'Tailspin Toys', 'Wingtip Group', 'Litware', 'Proseware']

function drawRoundedRect(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, fill: string) {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, radius)
  ctx.fill()
}

/** Bump with every change to `drawUiFrame` or the encoding, so a cached fixture video is never reused after it. */
export const FIXTURE_VERSION = 1

/** Text rows, a scrolling list and a modal that opens and closes, at a size that scales with the width. */
function drawUiFrame(ctx: OffscreenCanvasRenderingContext2D, options: FixtureOptions, seconds: number) {
  const { width, height, seconds: clipSeconds } = options
  const u = width / REFERENCE_WIDTH
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#f4f5f7'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, 64 * u)
  ctx.fillStyle = '#d8dbe2'
  ctx.fillRect(0, 64 * u, width, 2 * u)
  ctx.font = `${24 * u}px "Segoe UI", sans-serif`
  ctx.textBaseline = 'middle'
  ;['Overview', 'Customers', 'Billing', 'Reports', 'Settings'].forEach((tab, i) => {
    if (i === 2) drawRoundedRect(ctx, (300 + i * 170) * u, 12 * u, 150 * u, 40 * u, 10 * u, '#e5ecff')
    ctx.fillStyle = i === 2 ? '#2b55d6' : '#4a5468'
    ctx.fillText(tab, (324 + i * 170) * u, 34 * u)
  })

  const sidebarWidth = 280 * u
  ctx.fillStyle = '#eceef3'
  ctx.fillRect(0, 66 * u, sidebarWidth, height)
  for (let row = 0; row < 22; row++) {
    const y = (100 + row * 52) * u
    if (row === 4) drawRoundedRect(ctx, 16 * u, y - 8 * u, sidebarWidth - 32 * u, 44 * u, 10 * u, '#dbe3fb')
    drawRoundedRect(ctx, 32 * u, y + 4 * u, 22 * u, 22 * u, 6 * u, row === 4 ? '#2b55d6' : '#b6bccb')
    ctx.fillStyle = row === 4 ? '#2b55d6' : '#2c3445'
    ctx.font = `${22 * u}px "Segoe UI", sans-serif`
    ctx.fillText(`${WORDS[row % WORDS.length]} ${row % 3 === 0 ? 'settings' : 'list'}`, 72 * u, y + 16 * u)
  }

  const listLeft = sidebarWidth + 40 * u
  const listWidth = width - listLeft - 40 * u
  const rowHeight = 76 * u
  const scroll = seconds * 90 * u
  ctx.save()
  ctx.beginPath()
  ctx.rect(listLeft, 190 * u, listWidth, height - 190 * u)
  ctx.clip()
  const firstRow = Math.floor(scroll / rowHeight)
  for (let row = firstRow; row < firstRow + height / rowHeight + 2; row++) {
    const y = 190 * u + row * rowHeight - scroll
    drawRoundedRect(ctx, listLeft, y, listWidth, rowHeight - 8 * u, 12 * u, row % 2 === 0 ? '#ffffff' : '#fafbfc')
    ctx.font = `600 ${26 * u}px "Segoe UI", sans-serif`
    ctx.fillStyle = '#1d2433'
    ctx.fillText(`${WORDS[row % WORDS.length]} ${10_000 + row * 37}`, listLeft + 28 * u, y + 28 * u)
    ctx.font = `${22 * u}px "Segoe UI", sans-serif`
    ctx.fillStyle = '#667085'
    ctx.fillText(NAMES[(row * 5) % NAMES.length], listLeft + 28 * u, y + 54 * u)
    ctx.fillText(`${((row * 7919) % 9000) + 100}.00 USD`, listLeft + listWidth * 0.55, y + 38 * u)
    drawRoundedRect(ctx, listLeft + listWidth - 150 * u, y + 20 * u, 120 * u, 32 * u, 16 * u, row % 3 === 0 ? '#d6f5e3' : '#fde8c8')
  }
  ctx.restore()

  ctx.fillStyle = '#1d2433'
  ctx.font = `700 ${40 * u}px "Segoe UI", sans-serif`
  ctx.fillText('Billing', listLeft, 118 * u)
  ctx.font = `${22 * u}px "Segoe UI", sans-serif`
  ctx.fillStyle = '#667085'
  ctx.fillText('Subscriptions, invoices and credits for every account', listLeft, 156 * u)

  const progress = seconds / clipSeconds
  const modalShare = Math.min(Math.max((progress - 0.38) / 0.04, 0), 1) * Math.min(Math.max((0.62 - progress) / 0.04, 0), 1)
  if (modalShare > 0) {
    ctx.fillStyle = `rgba(16, 20, 32, ${0.45 * modalShare})`
    ctx.fillRect(0, 0, width, height)
    const modalWidth = 900 * u
    const modalHeight = 520 * u
    const left = (width - modalWidth) / 2
    const top = (height - modalHeight) / 2 + (1 - modalShare) * 40 * u
    drawRoundedRect(ctx, left, top, modalWidth, modalHeight, 24 * u, '#ffffff')
    ctx.fillStyle = '#1d2433'
    ctx.font = `700 ${34 * u}px "Segoe UI", sans-serif`
    ctx.fillText('Apply a credit', left + 48 * u, top + 70 * u)
    ctx.font = `${22 * u}px "Segoe UI", sans-serif`
    ctx.fillStyle = '#667085'
    for (let line = 0; line < 4; line++) ctx.fillText(`${NAMES[line]} will see this credit on the next statement.`, left + 48 * u, top + (130 + line * 40) * u)
    drawRoundedRect(ctx, left + 48 * u, top + 320 * u, modalWidth - 96 * u, 64 * u, 12 * u, '#f2f4f8')
    drawRoundedRect(ctx, left + modalWidth - 340 * u, top + modalHeight - 100 * u, 140 * u, 56 * u, 12 * u, '#e5e8ef')
    drawRoundedRect(ctx, left + modalWidth - 180 * u, top + modalHeight - 100 * u, 132 * u, 56 * u, 12 * u, '#2b55d6')
    ctx.fillStyle = '#ffffff'
    ctx.fillText('Apply', left + modalWidth - 150 * u, top + modalHeight - 70 * u)
  }
}

/** UI-like H.264 frames: tabs, a sidebar of text rows, a scrolling list and a modal that opens and closes. */
export async function renderFixtureVideo(options: FixtureOptions): Promise<Uint8Array> {
  const { width, height, fps, seconds } = options
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The browser could not create a canvas for the fixture.')
  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat(), target })
  const encoder = new CanvasSource(canvas, { codec: 'avc', quality: new Quality('high'), keyFrameInterval: KEY_FRAME_SECONDS })
  output.addVideoTrack(encoder, { frameRate: fps })
  await output.start()
  const frameCount = Math.round(seconds * fps)
  for (let frame = 0; frame < frameCount; frame++) {
    drawUiFrame(ctx, options, frame / fps)
    await encoder.add(frame / fps, 1 / fps)
  }
  await output.finalize()
  return new Uint8Array(target.buffer!)
}
