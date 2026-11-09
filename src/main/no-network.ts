export const NO_PROXY_SWITCH = 'no-proxy-server'

export function disableProxyResolution(commandLine: { appendSwitch(name: string, value?: string): void }): void {
  commandLine.appendSwitch(NO_PROXY_SWITCH)
}

export function connectDirectly(session: { setProxy(config: { mode: 'direct' }): Promise<void> }): Promise<void> {
  return session.setProxy({ mode: 'direct' })
}
