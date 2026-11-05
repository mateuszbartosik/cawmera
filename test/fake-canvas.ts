const gradientStub = () => ({ addColorStop: () => undefined })

const GRADIENT_METHODS = new Set(['createLinearGradient', 'createRadialGradient'])

interface FakeLayer {
  ctx: CanvasRenderingContext2D
  alphaAtCall: Record<string, number[]>
}

/** Offscreen layers share the target's `calls` but keep their own alphas, listed in `layers`. */
function buildFake(calls: string[], width: number, height: number) {
  const alphaAtCall: Record<string, number[]> = {}
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
        if (method === 'drawImage' && (args[0] as { tag?: string } | undefined)?.tag === 'video') calls.push('drawImage:video')
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
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, alphaAtCall }
}

export function fakeContext(size = { width: 1920, height: 1080 }): {
  ctx: CanvasRenderingContext2D
  calls: string[]
  alphaAtCall: Record<string, number[]>
  layers: FakeLayer[]
} {
  const calls: string[] = []
  const layers: FakeLayer[] = []
  globalThis.Path2D = class {} as unknown as typeof Path2D
  globalThis.OffscreenCanvas = class {
    constructor(
      public width: number,
      public height: number
    ) {}
    getContext() {
      const layer = buildFake(calls, this.width, this.height)
      layers.push(layer)
      return layer.ctx
    }
  } as unknown as typeof OffscreenCanvas
  return { ...buildFake(calls, size.width, size.height), layers }
}
