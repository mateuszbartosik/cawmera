import { describe, expect, it, vi } from 'vitest'
import { connectDirectly, disableProxyResolution } from '../src/main/no-network'

describe('no network', () => {
  it('turns proxy resolution off', () => {
    const appended: string[] = []
    disableProxyResolution({ appendSwitch: (name) => void appended.push(name) })
    expect(appended).toEqual(['no-proxy-server'])
  })

  it('makes a session connect directly', async () => {
    const setProxy = vi.fn(async () => {})
    await connectDirectly({ setProxy })
    expect(setProxy).toHaveBeenCalledWith({ mode: 'direct' })
  })

  it('logs a session that couldn’t be set to connect directly, leaving no rejection unhandled', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('Session is gone')
    await expect(connectDirectly({ setProxy: () => Promise.reject(failure) })).resolves.toBeUndefined()
    expect(logged).toHaveBeenCalledWith('A session couldn’t be set to connect directly', failure)
    logged.mockRestore()
  })
})
