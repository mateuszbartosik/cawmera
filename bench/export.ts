import { ALL_FORMATS, BufferSource, Input, VideoSampleSink } from 'mediabunny'
import { DEFAULT_DOC, type Doc } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { buildCameraPath, cameraAt, cameraTargets } from '../src/renderer/src/recording/camera'
import { exportRecordingVideo, type ExportTiming } from '../src/renderer/src/recording/export'
import { drawRecordingFrame, type RecordingScene } from '../src/renderer/src/recording/frame'
import type { RecordingEntry } from '../src/renderer/src/recording/registry'
import { recordingScene } from '../src/renderer/src/recording/scene'
import { recordingDocFor, type RecordingDoc, type RecordingFps } from '../src/renderer/src/recording/settings'
import { framePlan, type FrameQuality } from '../src/renderer/src/recording/shutter'
import { takeViewFor, type TakeView } from '../src/renderer/src/recording/take-view'
import { outputToSource } from '../src/renderer/src/recording/timemap'
import { autoZooms, type ZoomSegment } from '../src/renderer/src/recording/zooms'
import { FIXTURE_VERSION, movingShare, realtimeFactor, renderFixtureVideo, syntheticTake, type FixtureOptions } from './fixture'

interface BenchConfig { seconds: number; width: number; height: number; fps: RecordingFps; runs: number; compare: boolean }

interface BenchBridge {
  config(): Promise<BenchConfig>
  readCache(name: string): Promise<Uint8Array | null>
  writeCache(name: string, bytes: Uint8Array): Promise<void>
  progress(message: string): void
  finish(result: unknown): Promise<void>
  fail(message: string): Promise<void>
}

declare global {
  interface Window { bench: BenchBridge }
}

const SOURCE_SIZE = { width: 2560, height: 1440 }
const SOURCE_FPS = 60
const WARM_UP_TRIM = { start: 3000, end: 7000 }
const MS_PER_SECOND = 1000
const H264_HIGH_LEVEL_5 = 'avc1.640032'

/** A deep zoom at the frame’s lower left corner, so its edge, border and shadow fill part of the view. */
const COMPARED_ZOOM: ZoomSegment = { start: 8000, end: 15000, depth: 2.5, focus: { x: 0, y: SOURCE_SIZE.height } }
const FRAME_MS = MS_PER_SECOND / SOURCE_FPS
const framesFrom = (startMs: number, count: number, stepMs: number) => Array.from({ length: count }, (_, i) => startMs + i * stepMs)
/** The camera holds at depth 1 and 2.5, and moves through every frame of the zoom in and the zoom out. */
const COMPARED_FRAMES: Record<string, number[]> = {
  'depth 1': framesFrom(500, 10, 600),
  'zooming in': framesFrom(7100 + FRAME_MS, 60, FRAME_MS),
  'depth 2.5': framesFrom(9000, 10, 550),
  'zooming out': framesFrom(15000 + FRAME_MS, 60, FRAME_MS)
}
/** A frame of one picture, with the camera held or its blur off, shows the stage’s own difference. */
const STAGE_TOLERANCE = 3
/**
 * Camera-blurred frames average copies of the picture on the GPU, less exactly than 8-bit arithmetic: from pictures at
 * most 1 level apart, the copies of these frames end up to 5 levels apart on the bench PC.
 */
const CAMERA_BLURRED_TOLERANCE = 6

interface Difference {
  tolerance: number
  frames: number
  depths: number[]
  largest: number
  channelsOverOne: number
  channelsOverTolerance: number
  meanAbsolute: number
}

interface RunResult {
  totalMs: number
  timing: ExportTiming
  otherMs: number
  outputFrames: number
  outputSeconds: number
  bytes: number
}

const seconds = (ms: number) => `${(ms / MS_PER_SECOND).toFixed(1)} s`
/** The upper middle of an even count. */
const medianBy = <T>(items: T[], value: (item: T) => number): T => [...items].sort((a, b) => value(a) - value(b))[Math.floor(items.length / 2)]

async function fixtureVideo(options: FixtureOptions): Promise<{ bytes: Uint8Array; cached: boolean }> {
  const name = `fixture-v${FIXTURE_VERSION}-${options.seconds}s-${options.width}x${options.height}-${options.fps}fps.mp4`
  const cached = await window.bench.readCache(name)
  if (cached) return { bytes: cached, cached: true }
  const bytes = await renderFixtureVideo(options)
  await window.bench.writeCache(name, bytes)
  return { bytes, cached: false }
}

async function exportedShape(bytes: Uint8Array): Promise<{ frames: number; seconds: number }> {
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('The exported file has no video.')
    const stats = await track.computePacketStats()
    return { frames: stats.packetCount, seconds: await input.computeDuration() }
  } finally {
    input.dispose()
  }
}

async function encoderSupport(width: number, height: number, fps: number) {
  const supports = async (hardwareAcceleration: HardwareAcceleration) =>
    (await VideoEncoder.isConfigSupported({ codec: H264_HIGH_LEVEL_5, width, height, framerate: fps, hardwareAcceleration })).supported ?? false
  return { avcHardware: await supports('prefer-hardware'), avcSoftware: await supports('prefer-software') }
}

async function webGpuAdapter() {
  const adapter = await navigator.gpu?.requestAdapter().catch(() => null)
  const info = adapter?.info
  return info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null
}

const withOneZoom = (view: TakeView, zoom: ZoomSegment, recording: RecordingDoc): TakeView => ({
  ...view,
  zooms: [zoom],
  camera: buildCameraPath(cameraTargets([zoom], view.frame, recording.zoomSpeed), recording.zoomSpeed, view.frame)
})

/** Draws on a fresh canvas, as the export does, so no earlier frame’s layers or readbacks change how it renders. */
function drawnFrame(scene: RecordingScene, outputMs: number, quality: FrameQuality): OffscreenCanvas {
  const canvas = new OffscreenCanvas(scene.doc.size.width, scene.doc.size.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The browser could not create a canvas for the frames.')
  drawRecordingFrame(ctx, scene, outputMs, quality)
  return canvas
}

/** Reads a snapshot through a CPU canvas, so the drawn canvas is never read back and stays on the GPU. */
async function pixelsOf(canvas: OffscreenCanvas): Promise<Uint8ClampedArray> {
  const snapshot = await createImageBitmap(canvas)
  const reader = new OffscreenCanvas(canvas.width, canvas.height).getContext('2d', { willReadFrequently: true })
  if (!reader) throw new Error('The browser could not create a canvas to read the frames.')
  reader.drawImage(snapshot, 0, 0)
  snapshot.close()
  return reader.getImageData(0, 0, canvas.width, canvas.height).data
}

function addDifference(differences: Record<string, Difference>, name: string, tolerance: number, staged: Uint8ClampedArray, live: Uint8ClampedArray, depth: number) {
  const total = (differences[name] ??= { tolerance, frames: 0, depths: [], largest: 0, channelsOverOne: 0, channelsOverTolerance: 0, meanAbsolute: 0 })
  let sum = 0
  for (let i = 0; i < staged.length; i++) {
    const difference = Math.abs(staged[i] - live[i])
    sum += difference
    if (difference > total.largest) total.largest = difference
    if (difference > 1) total.channelsOverOne++
    if (difference > tolerance) total.channelsOverTolerance++
  }
  total.meanAbsolute = (total.meanAbsolute * total.frames + sum / staged.length) / (total.frames + 1)
  total.frames++
  total.depths.push(Math.round(depth * 1000) / 1000)
}

/**
 * Every compared frame drawn twice at one canvas px per output px: as the export draws it, over the cached stage, and as
 * the preview draws it, with the shadow cast live. Each frame blends the same samples either way. A frame the camera
 * blurs is compared again with the camera blur off, where it is one picture.
 */
async function compareStage(fixtureBytes: Uint8Array, entry: RecordingEntry, doc: Doc & { recording: RecordingDoc }) {
  const input = new Input({ source: new BufferSource(fixtureBytes), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('The fixture has no video.')
    const firstFrameSeconds = await track.getFirstTimestamp()
    const unzoomed = recordingScene(entry, doc, DEFAULT_HOUSE_STYLE, null, new OffscreenCanvas(1, 1))!
    const scene: RecordingScene = { ...unzoomed, view: withOneZoom(unzoomed.view, COMPARED_ZOOM, doc.recording) }
    const sharpCamera: RecordingScene = { ...scene, settings: { ...scene.settings, cameraBlur: 0 } }
    const frames = Object.entries(COMPARED_FRAMES).flatMap(([group, times]) => times.map((outputMs) => ({ group, outputMs })))
    const sourceSeconds = frames.map(({ outputMs }) => Math.max(outputToSource(scene.view.map, outputMs) / MS_PER_SECOND, firstFrameSeconds))
    const differences: Record<string, Difference> = {}

    const compare = async (name: string, tolerance: number, frameScene: RecordingScene, outputMs: number) => {
      const [exported, previewed] = [framePlan(frameScene, outputMs, 'export'), framePlan(frameScene, outputMs, 'preview')]
      if (exported.camera !== previewed.camera || exported.cursor !== previewed.cursor) {
        throw new Error(`At ${outputMs} ms the export and the preview blend different samples, so the frame can’t compare the stage alone.`)
      }
      const [staged, live] = await Promise.all([pixelsOf(drawnFrame(frameScene, outputMs, 'export')), pixelsOf(drawnFrame(frameScene, outputMs, 'preview'))])
      addDifference(differences, name, tolerance, staged, live, cameraAt(scene.view.camera, outputMs).depth)
    }

    let index = 0
    for await (const sample of new VideoSampleSink(track).samplesAtTimestamps(sourceSeconds)) {
      try {
        if (!sample) throw new Error('The fixture has no picture at a compared frame.')
        const { group, outputMs } = frames[index]
        const video = sample.toCanvasImageSource()
        if (framePlan({ ...scene, video }, outputMs, 'export').camera === 1) {
          await compare(`${group}, camera held`, STAGE_TOLERANCE, { ...scene, video }, outputMs)
        } else {
          await compare(`${group}, camera blur off`, STAGE_TOLERANCE, { ...sharpCamera, video }, outputMs)
          await compare(`${group}, camera blurred`, CAMERA_BLURRED_TOLERANCE, { ...scene, video }, outputMs)
        }
      } finally {
        sample?.close()
      }
      index++
    }

    for (const [name, difference] of Object.entries(differences)) {
      window.bench.progress(`${name}: ${difference.frames} frames at depth ${Math.min(...difference.depths)}–${Math.max(...difference.depths)}`
        + `, largest channel difference ${difference.largest} (at most ${difference.tolerance}), ${difference.channelsOverOne} channels off by more than 1`
        + `, mean ${difference.meanAbsolute.toFixed(4)}`)
    }
    const failing = Object.entries(differences).filter(([, difference]) => difference.largest > difference.tolerance)
    if (failing.length > 0) {
      await window.bench.fail(`the cached stage differs from the live shadow by more than allowed in ${failing.map(([name]) => name).join('; ')}`)
      return
    }
    await window.bench.finish({
      line: `stage compare ${doc.size.width}×${doc.size.height}: every channel within ${STAGE_TOLERANCE} of the live shadow in one picture,`
        + ` and within ${CAMERA_BLURRED_TOLERANCE} with the camera blurred`,
      compare: { zoom: COMPARED_ZOOM, frames: COMPARED_FRAMES, differences }
    })
  } finally {
    input.dispose()
  }
}

async function runBench(config: BenchConfig) {
  const fixtureOptions: FixtureOptions = { seconds: config.seconds, ...SOURCE_SIZE, fps: SOURCE_FPS }
  const startedFixture = performance.now()
  const fixture = await fixtureVideo(fixtureOptions)
  window.bench.progress(`fixture: ${(fixture.bytes.byteLength / 2 ** 20).toFixed(1)} MB, ${fixture.cached ? 'cached' : `rendered in ${seconds(performance.now() - startedFixture)}`}`)

  const track = syntheticTake(fixtureOptions)
  const entry: RecordingEntry = { id: 'bench', name: 'Benchmark take', poster: null, track }
  const recording: RecordingDoc = { ...recordingDocFor(track, null), fps: config.fps }
  const doc: Doc & { recording: RecordingDoc } = { ...DEFAULT_DOC, size: { width: config.width, height: config.height }, recording }
  if (config.compare) return compareStage(fixture.bytes, entry, doc)
  const view = takeViewFor(entry, recording, null)
  const clipMs = view.map.outputMs
  const expectedFrames = Math.ceil((clipMs * config.fps) / MS_PER_SECOND - 1e-9)

  const exportOnce = async (document: Doc & { recording: RecordingDoc }, settleDraws: boolean): Promise<RunResult> => {
    let timing: ExportTiming | null = null
    const started = performance.now()
    const bytes = await exportRecordingVideo(entry, document, DEFAULT_HOUSE_STYLE, null, () => undefined, {
      source: new BufferSource(fixture.bytes),
      onTiming: (measured) => { timing = measured },
      settleDraws
    })
    const totalMs = performance.now() - started
    if (!timing) throw new Error('The export reported no timing.')
    const measured: ExportTiming = timing
    const shape = await exportedShape(bytes)
    const expectedFrames = Math.ceil((takeViewFor(entry, document.recording, null).map.outputMs * document.recording.fps) / MS_PER_SECOND - 1e-9)
    const expectedSeconds = expectedFrames / document.recording.fps
    if (shape.frames !== expectedFrames) throw new Error(`The export has ${shape.frames} frames, expected ${expectedFrames}.`)
    if (Math.abs(shape.seconds - expectedSeconds) > 1 / document.recording.fps) throw new Error(`The export lasts ${shape.seconds} s, expected ${expectedSeconds} s.`)
    const stagesMs = measured.decodeWaitMs + measured.drawMs + measured.encodeWaitMs + measured.finalizeMs
    return { totalMs, timing: measured, otherMs: totalMs - stagesMs, outputFrames: shape.frames, outputSeconds: shape.seconds, bytes: bytes.byteLength }
  }

  window.bench.progress('warm-up')
  await exportOnce({ ...doc, recording: { ...recording, trim: WARM_UP_TRIM } }, false)

  const runs: RunResult[] = []
  for (let run = 1; run <= config.runs; run++) {
    runs.push(await exportOnce(doc, false))
    window.bench.progress(`run ${run} of ${config.runs}: ${seconds(runs[run - 1].totalMs)}`)
  }
  window.bench.progress('run with each frame settled')
  const settled = await exportOnce(doc, true)

  const medianRun = medianBy(runs, (run) => run.totalMs)
  const bestRun = runs.reduce((best, run) => (run.totalMs < best.totalMs ? run : best))
  const { timing } = medianRun
  const factor = realtimeFactor(clipMs, medianRun.totalMs)
  const settledTotals = `draw ${seconds(settled.timing.drawMs)} (blur frames ${seconds(settled.timing.blurDrawMs)}) · encode wait ${seconds(settled.timing.encodeWaitMs)}`
  const line = `export ${config.width}×${config.height} @ ${config.fps} fps of a ${seconds(clipMs)} take: ${seconds(medianRun.totalMs)} (${factor.toFixed(2)}× real time)`
    + ` · draw submit ${seconds(timing.drawMs)} · GPU and encode wait ${seconds(timing.encodeWaitMs)} · decode wait ${seconds(timing.decodeWaitMs)} · finalize ${seconds(timing.finalizeMs)} · other ${seconds(medianRun.otherMs)}`
    + ` · median of ${runs.length} (upper middle), best ${seconds(bestRun.totalMs)} (${realtimeFactor(clipMs, bestRun.totalMs).toFixed(2)}×)`
    + ` | settled run (approximate, the per-frame flush adds up to ${seconds(settled.totalMs - medianRun.totalMs)}) ${seconds(settled.totalMs)}: ${settledTotals}`
  window.bench.progress(`frames: ${medianRun.outputFrames} exported, ${expectedFrames} expected; ${timing.blurredFrames} of ${timing.frames} drawn from several blur samples`
    + ` (${timing.cameraBlurredFrames} with the camera re-projected; ${timing.cameraSamples} camera and ${timing.cursorSamples} cursor samples in all)`)

  await window.bench.finish({
    line,
    config,
    fixture: {
      ...fixtureOptions,
      bytes: fixture.bytes.byteLength,
      cached: fixture.cached,
      movingShare: movingShare(track),
      clicks: track.clicks.length,
      zooms: autoZooms(track.clicks, track, recording.trim, recording.zoomSpeed).length,
      trim: recording.trim
    },
    clip: { ms: clipMs, expectedFrames },
    runs,
    median: medianRun,
    best: bestRun,
    settled,
    medianRealtimeFactor: factor,
    summary: {
      totalMs: medianRun.totalMs,
      realtimeFactor: factor,
      drawSubmitMs: timing.drawMs,
      gpuAndEncodeWaitMs: timing.encodeWaitMs,
      settledTotalMs: settled.totalMs,
      settledOverheadUpperBoundMs: settled.totalMs - medianRun.totalMs,
      settledDrawMs: settled.timing.drawMs,
      settledBlurDrawMs: settled.timing.blurDrawMs,
      settledEncodeWaitMs: settled.timing.encodeWaitMs
    },
    encoder: await encoderSupport(config.width, config.height, config.fps),
    webGpuAdapter: await webGpuAdapter()
  })
}

window.bench.config()
  .then(runBench)
  .catch((error: unknown) => window.bench.fail(error instanceof Error ? (error.stack ?? error.message) : String(error)))
