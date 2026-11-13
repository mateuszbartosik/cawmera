export const NO_PROXY_SWITCH = 'no-proxy-server'

export function disableProxyResolution(commandLine: { appendSwitch(name: string, value?: string): void }): void {
  commandLine.appendSwitch(NO_PROXY_SWITCH)
}

/** Settles either way: a session that couldn't be set is logged, and the no-proxy-server switch still keeps it from looking for a proxy. */
export function connectDirectly(session: { setProxy(config: { mode: 'direct' }): Promise<void> }): Promise<void> {
  return session.setProxy({ mode: 'direct' }).catch((error: unknown) => console.error('A session couldn’t be set to connect directly', error))
}
