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
function buildFake(calls: string[], width: number, height: number) {
  const alphaAtCall: Record<string, number[]> = {}
  const argsAtCall: Record<string, unknown[][]> = {}
  let properties = new Map<string | symbol, unknown>([
    ['globalAlpha', 1],
    ['canvas', { width, height }]
  ])
  const saved: Map<string | symbol, unknown>[] = []

  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(_target, name) {
      if (properties.has(name)) return properties.get(name)
      return (...args: unknown[]) => {
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
      properties.set(name, value)
      calls.push(`${String(name)}=${String(value)}`)
      return true
    }
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, alphaAtCall, argsAtCall }
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
  globalThis.Path2D = class {} as unknown as typeof Path2D
  globalThis.OffscreenCanvas = class {
    readonly tag = 'offscreen'
    constructor(
      public width: number,
      public height: number
    ) {}
    getContext(_type: string, settings?: unknown) {
      const layer = buildFake(calls, this.width, this.height)
      layers.push({ ...layer, canvas: this as unknown as OffscreenCanvas, settings })
      return layer.ctx
    }
  } as unknown as typeof OffscreenCanvas
  return { ...buildFake(calls, size.width, size.height), layers }
}
