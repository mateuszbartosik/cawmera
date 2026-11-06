import { useEffect, useState } from 'react'
import type { RecordingSupport } from '@shared/types'
import { bridge } from '../platform/bridge'

let known: Promise<RecordingSupport> | null = null

/** What recording can do here; null while it is being asked, and always null in the browser build. */
export function useRecordingSupport(): RecordingSupport | null {
  const [support, setSupport] = useState<RecordingSupport | null>(null)
  useEffect(() => {
    if (!bridge) return
    known ??= bridge.recordingSupport().catch((error: unknown) => {
      known = null
      throw error
    })
    let alive = true
    known.then(
      (result) => alive && setSupport(result),
      () => alive && setSupport({ ok: false, reason: 'helper-missing' })
    )
    return () => {
      alive = false
    }
  }, [])
  return support
}

export function unavailableReason(support: Extract<RecordingSupport, { ok: false }>): string {
  switch (support.reason) {
    case 'platform':
      return 'Recording works on Windows only'
    case 'windows-version':
      return 'Recording needs Windows 10 version 2004 or newer'
    case 'helper-missing':
      return 'The recorder is missing from this build'
  }
}
