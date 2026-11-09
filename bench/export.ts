import { ALL_FORMATS, BufferSource, Input } from 'mediabunny'
import { DEFAULT_DOC, type Doc } from '../src/renderer/src/app/doc'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { exportRecordingVideo, type ExportTiming } from '../src/renderer/src/recording/export'
import type { RecordingEntry } from '../src/renderer/src/recording/registry'
import { recordingDocFor, type RecordingDoc, type RecordingFps } from '../src/renderer/src/recording/settings'
import { takeViewFor } from '../src/renderer/src/recording/take-view'
import { autoZooms } from '../src/renderer/src/recording/zooms'
import { movingShare, realtimeFactor, renderFixtureVideo, syntheticTake, type FixtureOptions } from './fixture'

interface BenchConfig { seconds: number; width: number; height: number; fps: RecordingFps; runs: number }

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
const FIXTURE_VERSION = 1
const WARM_UP_TRIM = { start: 3000, end: 7000 }
const MS_PER_SECOND = 1000
const H264_HIGH_LEVEL_5 = 'avc1.640032'

interface RunResult {
  totalMs: number
  timing: ExportTiming
  otherMs: number
  outputFrames: number
  outputSeconds: number
  bytes: number
}

const seconds = (ms: number) => `${(ms / MS_PER_SECOND).toFixed(1)} s`
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

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

async function runBench(config: BenchConfig) {
  const fixtureOptions: FixtureOptions = { seconds: config.seconds, ...SOURCE_SIZE, fps: SOURCE_FPS }
  const startedFixture = performance.now()
  const fixture = await fixtureVideo(fixtureOptions)
  window.bench.progress(`fixture: ${(fixture.bytes.byteLength / 2 ** 20).toFixed(1)} MB, ${fixture.cached ? 'cached' : `rendered in ${seconds(performance.now() - startedFixture)}`}`)

  const track = syntheticTake(fixtureOptions)
  const entry: RecordingEntry = { id: 'bench', name: 'Benchmark take', poster: null, track }
  const recording: RecordingDoc = { ...recordingDocFor(track, null), fps: config.fps }
  const doc: Doc & { recording: RecordingDoc } = { ...DEFAULT_DOC, size: { width: config.width, height: config.height }, recording }
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

  const byTotal = [...runs].sort((a, b) => a.totalMs - b.totalMs)
  const medianRun = byTotal[Math.floor(byTotal.length / 2)]
  const bestRun = byTotal[0]
  const { timing } = medianRun
  const factor = realtimeFactor(clipMs, medianRun.totalMs)
  const line = `export ${config.width}×${config.height} @ ${config.fps} fps of a ${seconds(clipMs)} take: ${seconds(medianRun.totalMs)} (${factor.toFixed(2)}× real time)`
    + ` · decode wait ${seconds(timing.decodeWaitMs)} · draw ${seconds(timing.drawMs)} (blur ${seconds(timing.blurDrawMs)})`
    + ` · encode wait ${seconds(timing.encodeWaitMs)} · finalize ${seconds(timing.finalizeMs)} · other ${seconds(medianRun.otherMs)}`
    + ` · median of ${runs.length}, best ${seconds(bestRun.totalMs)} (${realtimeFactor(clipMs, bestRun.totalMs).toFixed(2)}×)`
  const settledLine = `settled run (GPU work counted in draw): ${seconds(settled.totalMs)} · draw ${seconds(settled.timing.drawMs)} (blur ${seconds(settled.timing.blurDrawMs)}) · encode wait ${seconds(settled.timing.encodeWaitMs)}`
  window.bench.progress(settledLine)
  window.bench.progress(`frames: ${medianRun.outputFrames} exported, ${expectedFrames} expected; ${timing.blurredFrames} of ${timing.frames} drawn from several blur samples (${timing.drawnSamples} samples in all)`)

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
    medianOfRunTotalsMs: median(runs.map((run) => run.totalMs)),
    encoder: await encoderSupport(config.width, config.height, config.fps),
    webGpuAdapter: await webGpuAdapter()
  })
}

window.bench.config()
  .then(runBench)
  .catch((error: unknown) => window.bench.fail(error instanceof Error ? (error.stack ?? error.message) : String(error)))
