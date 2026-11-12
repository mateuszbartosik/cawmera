const gradientStub = () => ({ addColorStop: () => undefined })

const GRADIENT_METHODS = new Set(['createLinearGradient', 'createRadialGradient'])

export interface FakeLayer {
  ctx: CanvasRenderingContext2D
  alphaAtCall: Record<string, number[]>
  argsAtCall: Record<string, unknown[][]>
  canvas: OffscreenCanvas
  settings: unknown
}

/**
 * Offscreen layers share the target's `calls` but keep their own alphas and arguments, listed in `layers`. Drawing anything
 * tagged, like a fake video or an offscreen canvas, also records `drawImage:<tag>`.
 */
interface Current {
  calls: string[]
  layers: FakeLayer[]
}

/** Canvases that outlive a test, like compose's scratch cache, record into whichever fake is current: a fake's calls and layers are valid only until the next fakeContext(). */
let current: Current = { calls: [], layers: [] }
let currentEpoch = 0

function buildFake(width: number, height: number, onFirstUse?: (layer: Pick<FakeLayer, 'ctx' | 'alphaAtCall' | 'argsAtCall'>) => void) {
  const alphaAtCall: Record<string, number[]> = {}
  const argsAtCall: Record<string, unknown[][]> = {}
  const freshProperties = () =>
    new Map<string | symbol, unknown>([
      ['globalAlpha', 1],
      ['canvas', { width, height }]
    ])
  let properties = freshProperties()
  const saved: Map<string | symbol, unknown>[] = []
  let epoch = currentEpoch
  const enterCurrentFake = () => {
    if (epoch === currentEpoch) return
    epoch = currentEpoch
    for (const key of Object.keys(alphaAtCall)) delete alphaAtCall[key]
    for (const key of Object.keys(argsAtCall)) delete argsAtCall[key]
    properties = freshProperties()
    saved.length = 0
    onFirstUse?.(layer)
  }
  const layer = {} as Pick<FakeLayer, 'ctx' | 'alphaAtCall' | 'argsAtCall'>

  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(_target, name) {
      enterCurrentFake()
      if (properties.has(name)) return properties.get(name)
      return (...args: unknown[]) => {
        enterCurrentFake()
        const { calls } = current
        const method = String(name)
        calls.push(method)
        const alphas = alphaAtCall[method] ?? []
        alphas.push(properties.get('globalAlpha') as number)
        alphaAtCall[method] = alphas
        const argsSoFar = argsAtCall[method] ?? []
        argsSoFar.push(args)
        argsAtCall[method] = argsSoFar
        const tag = (args[0] as { tag?: string } | undefined)?.tag
        if (method === 'drawImage' && tag) calls.push(`drawImage:${tag}`)
        if (method === 'save') saved.push(new Map(properties))
        if (method === 'restore') properties = saved.pop() ?? properties
        return GRADIENT_METHODS.has(method) ? gradientStub() : args[0]
      }
    },
    set(_target, name, value) {
      enterCurrentFake()
      properties.set(name, value)
      current.calls.push(`${String(name)}=${String(value)}`)
      return true
    }
  })
  Object.assign(layer, { ctx: ctx as unknown as CanvasRenderingContext2D, alphaAtCall, argsAtCall })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, alphaAtCall, argsAtCall }
}

export function fakeContext(size = { width: 1920, height: 1080 }): {
  ctx: CanvasRenderingContext2D
  calls: string[]
  alphaAtCall: Record<string, number[]>
  argsAtCall: Record<string, unknown[][]>
  layers: FakeLayer[]
} {
  const calls: string[] = []
  const layers: FakeLayer[] = []
  current = { calls, layers }
  currentEpoch++
  globalThis.Path2D = class {} as unknown as typeof Path2D
  globalThis.OffscreenCanvas = class {
    readonly tag = 'offscreen'
    constructor(
      public width: number,
      public height: number
    ) {}
    getContext(_type: string, settings?: unknown) {
      const canvas = this as unknown as OffscreenCanvas
      const layer = buildFake(this.width, this.height, (reused) => current.layers.push({ ...reused, canvas, settings }))
      layers.push({ ...layer, canvas, settings })
      return layer.ctx
    }
  } as unknown as typeof OffscreenCanvas
  return { ...buildFake(size.width, size.height), calls, layers }
}
