const gradientStub = () => ({ addColorStop: () => undefined })

const GRADIENT_METHODS = new Set(['createLinearGradient', 'createRadialGradient'])

export function fakeContext(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = []
  const properties = new Map<string | symbol, unknown>()
  globalThis.Path2D = class {} as unknown as typeof Path2D

  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(_target, name) {
      if (properties.has(name)) return properties.get(name)
      return (...args: unknown[]) => {
        calls.push(String(name))
        return GRADIENT_METHODS.has(String(name)) ? gradientStub() : args[0]
      }
    },
    set(_target, name, value) {
      properties.set(name, value)
      calls.push(`${String(name)}=${String(value)}`)
      return true
    }
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}
