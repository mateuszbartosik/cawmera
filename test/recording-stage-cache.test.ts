import { describe, expect, it } from 'vitest'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { drawRecordingFrame, type RecordingScene } from '../src/renderer/src/recording/frame'
import { recordingLayout } from '../src/renderer/src/recording/layout'
import { cameraMatrixAt } from '../src/renderer/src/recording/shutter'
import { stageKey } from '../src/renderer/src/recording/stage-cache'
import { compose, translation, type Matrix } from '../src/renderer/src/render/geometry'
import { fakeContext } from './fake-canvas'
import { output, stillScene, track, viewOf, zoomScene } from './recording-scenes'

const content = { x: 171, y: 96, w: 1579, h: 888 }
const radius = 20
const FRAME_SHAPE_FILL = 'fillStyle=#05070d'

const shadowsCast = (calls: string[]) => calls.filter((call) => call.startsWith('shadowOffsetY=')).length
const isStage = (image: unknown) => (image as { width?: number; height?: number }).width === output.width && (image as { height?: number }).height === output.height

/** The target with the transform it had at each offscreen image it drew. */
function watchedTarget() {
  const fake = fakeContext()
  let current: Matrix = [1, 0, 0, 1, 0, 0]
  const offscreenDraws: { image: unknown; transform: Matrix; args: unknown[] }[] = []
  const ctx = new Proxy(fake.ctx, {
    get(target, name) {
      const value = Reflect.get(target, name)
      if (name === 'setTransform') return (...matrix: Matrix) => { current = matrix; return (value as (...args: Matrix) => void)(...matrix) }
      if (name === 'drawImage') {
        return (...args: unknown[]) => {
          if ((args[0] as { tag?: string }).tag === 'offscreen') offscreenDraws.push({ image: args[0], transform: current, args })
          return (value as (...args: unknown[]) => void)(...args)
        }
      }
      return value
    }
  })
  return { ...fake, ctx, offscreenDraws }
}

interface LayerDraw { layer: unknown; call: 'drawImage' | 'fill'; args: unknown[]; transform: Matrix; fillStyle: unknown }

/** Every image drawn and every path filled on an offscreen layer, with the layer’s transform and fill at the time. */
function watchLayers(): LayerDraw[] {
  const draws: LayerDraw[] = []
  const Layer = globalThis.OffscreenCanvas as unknown as new (width: number, height: number) => {
    getContext(type: string, settings?: unknown): CanvasRenderingContext2D
  }
  globalThis.OffscreenCanvas = class extends Layer {
    getContext(type: string, settings?: unknown) {
      const layer = this
      const ctx = super.getContext(type, settings)
      let transform: Matrix = [1, 0, 0, 1, 0, 0]
      let fillStyle: unknown = null
      return new Proxy(ctx, {
        get(target, name) {
          const value = Reflect.get(target, name) as (...args: unknown[]) => unknown
          if (name === 'setTransform') return (...matrix: Matrix) => { transform = matrix; return value(...matrix) }
          if (name === 'drawImage' || name === 'fill') {
            return (...args: unknown[]) => { draws.push({ layer, call: name, args, transform, fillStyle }); return value(...args) }
          }
          return value
        },
        set(target, name, value) {
          if (name === 'fillStyle') fillStyle = value
          return Reflect.set(target, name, value)
        }
      })
    }
  } as unknown as typeof OffscreenCanvas
  return draws
}

describe('stageKey', () => {
  it('keys the stage on everything the frame’s shadow depends on', () => {
    const base = stageKey(output, content, radius, DEFAULT_HOUSE_STYLE)
    const changed = [
      stageKey({ width: 1280, height: 720 }, content, radius, DEFAULT_HOUSE_STYLE),
      stageKey(output, { ...content, x: 172 }, radius, DEFAULT_HOUSE_STYLE),
      stageKey(output, { ...content, y: 95 }, radius, DEFAULT_HOUSE_STYLE),
      stageKey(output, { ...content, w: 1280 }, radius, DEFAULT_HOUSE_STYLE),
      stageKey(output, { ...content, h: 720 }, radius, DEFAULT_HOUSE_STYLE),
      stageKey(output, content, 12, DEFAULT_HOUSE_STYLE),
      stageKey(output, content, radius, { ...DEFAULT_HOUSE_STYLE, shadow: 0.2 })
    ]
    for (const key of changed) expect(key).not.toBe(base)
    expect(new Set(changed).size).toBe(changed.length)
    const otherPlateAndBorder = { ...DEFAULT_HOUSE_STYLE, plateFrom: '#FF0000', glow: '#00FF00', border: 0.5 }
    expect(stageKey(output, content, radius, otherPlateAndBorder)).toBe(base)
  })
})

describe('the export’s stage', () => {
  it('casts the frame’s shadow once for export frames with the same look', () => {
    const fake = fakeContext()
    for (const t of [4000, 4016.7, 4033.3]) drawRecordingFrame(fake.ctx, stillScene, t, 'export')
    expect(shadowsCast(fake.calls)).toBe(1)
    expect(fake.layers.filter((layer) => isStage(layer.canvas))).toHaveLength(1)
  })

  it('holds the shadow alone: the frame’s shape sits left of the stage, and its shadow comes back by as many whole px', () => {
    const fake = fakeContext()
    drawRecordingFrame(fake.ctx, stillScene, 4000, 'export')
    const stage = fake.layers.find((layer) => isStage(layer.canvas))!
    const { content } = recordingLayout(stillScene.view.frame, output, stillScene.style)
    const xs = ['moveTo', 'lineTo'].flatMap((method) => stage.argsAtCall[method].map((args) => args[0] as number))
    const away = Number(fake.calls.find((call) => call.startsWith('shadowOffsetX='))!.split('=')[1])
    expect(Number.isInteger(away)).toBe(true)
    expect(Math.max(...xs)).toBeLessThan(0)
    expect(Math.min(...xs) + away).toBeCloseTo(content.x, 9)
    expect(Math.max(...xs) + away).toBeCloseTo(content.x + content.w, 9)
    expect(fake.calls).toEqual(expect.arrayContaining(['shadowBlur=80', 'shadowOffsetY=28', `shadowColor=rgba(0, 0, 0, ${DEFAULT_HOUSE_STYLE.shadow})`]))
  })

  it('casts the shadow live in every preview frame', () => {
    const fake = fakeContext()
    for (const t of [4000, 4016.7, 4033.3]) drawRecordingFrame(fake.ctx, stillScene, t, 'preview', 1)
    expect(shadowsCast(fake.calls)).toBe(3)
    expect(fake.layers.filter((layer) => isStage(layer.canvas))).toHaveLength(0)
  })

  it('casts the shadow live in an export frame drawn at any other scale', () => {
    const fake = fakeContext()
    for (const t of [4000, 4016.7]) drawRecordingFrame(fake.ctx, stillScene, t, 'export', 0.5)
    expect(shadowsCast(fake.calls)).toBe(2)
  })

  it('casts the shadow again when the crop or the output changes the frame', () => {
    const fake = fakeContext()
    const cropped: RecordingScene = { ...stillScene, view: viewOf(track, { x: 640, y: 360, w: 1280, h: 1080 }) }
    const square: RecordingScene = { ...stillScene, doc: { ...stillScene.doc, size: { width: 1080, height: 1080 } } }
    expect(recordingLayout(cropped.view.frame, output, cropped.style).content).not.toEqual(recordingLayout(stillScene.view.frame, output, stillScene.style).content)
    for (const scene of [stillScene, cropped, square]) drawRecordingFrame(fake.ctx, scene, 4000, 'export')
    expect(shadowsCast(fake.calls)).toBe(3)
  })

  it('lays the stage under the camera’s view over the background, then the frame’s shape with no shadow of its own', () => {
    const t = 4000
    const target = watchedTarget()
    drawRecordingFrame(target.ctx, stillScene, t, 'export')
    const firstFrameCalls = target.calls.length
    drawRecordingFrame(target.ctx, stillScene, t, 'export')

    const stages = target.offscreenDraws.filter((draw) => isStage(draw.image))
    expect(stages).toHaveLength(2)
    expect(stages[1].image).toBe(stages[0].image)
    for (const stage of stages) {
      expect(stage.transform).toEqual(cameraMatrixAt(stillScene, t))
      expect(stage.args.slice(1)).toEqual([0, 0])
    }
    const secondFrame = target.calls.slice(firstFrameCalls)
    const stageAt = secondFrame.indexOf('drawImage:offscreen')
    expect(secondFrame.lastIndexOf('createRadialGradient')).toBeLessThan(stageAt)
    const shapeAt = secondFrame.indexOf(FRAME_SHAPE_FILL)
    expect(shapeAt).toBeGreaterThan(stageAt)
    expect(secondFrame.indexOf('fill', shapeAt)).toBeLessThan(secondFrame.indexOf('drawImage:video'))
    expect(shadowsCast(secondFrame)).toBe(0)
  })

  it('lays the stage inside a re-projected picture under the picture’s view, where the live frame casts its shadow', () => {
    const t = 2700
    const exported = fakeContext()
    const exportedDraws = watchLayers()
    drawRecordingFrame(exported.ctx, zoomScene, t, 'export')
    const previewed = fakeContext()
    const previewedDraws = watchLayers()
    drawRecordingFrame(previewed.ctx, zoomScene, t, 'preview', 1)

    const holdsVideo = (draw: LayerDraw) => draw.call === 'drawImage' && (draw.args[0] as { tag?: string }).tag === 'video'
    const exportedPicture = exportedDraws.find(holdsVideo)!.layer
    const previewedPicture = previewedDraws.find(holdsVideo)!.layer
    const stages = exportedDraws.filter((draw) => draw.call === 'drawImage' && isStage(draw.args[0]))
    expect(stages).toHaveLength(1)
    expect(stages[0].layer).toBe(exportedPicture)
    expect(stages[0].args.slice(1)).toEqual([0, 0])

    const copies = (exported.argsAtCall['drawImage'] ?? []).filter((args) => args[0] === exportedPicture)
    expect(copies.length).toBeGreaterThan(1)
    const margin = -(copies[0][5] as number)
    expect(margin).toBeGreaterThan(0)
    expect(stages[0].transform).toEqual(compose(translation(margin, margin), cameraMatrixAt(zoomScene, t)))
    const liveShadow = previewedDraws.find((draw) => draw.layer === previewedPicture && draw.call === 'fill' && draw.fillStyle === '#05070d')!
    expect(stages[0].transform).toEqual(liveShadow.transform)
    expect(shadowsCast(exported.calls)).toBe(1)
  })

  it('needs no stage when the house style casts no shadow', () => {
    const fake = fakeContext()
    const shadowless: RecordingScene = { ...stillScene, style: { ...DEFAULT_HOUSE_STYLE, shadow: 0 } }
    drawRecordingFrame(fake.ctx, shadowless, 4000, 'export')
    expect(fake.layers.filter((layer) => isStage(layer.canvas))).toHaveLength(0)
    expect(fake.calls).not.toContain(FRAME_SHAPE_FILL)
  })
})
