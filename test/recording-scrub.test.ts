import { beforeEach, describe, expect, it, vi } from 'vitest'
import { store } from '../src/renderer/src/app/store'
import { attachPlayer, currentPlayhead, grabPlayheadFrame, scrubTo, setPlayhead } from '../src/renderer/src/recording/playback'
import type { RecordingPlayer } from '../src/renderer/src/recording/player'

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

/**
 * Seeks as the real player does, but lands only when told: `land()` shows the frame the oldest seek asked for, as the canvas
 * would on `seeked`, then ends that seek's wait. `showsFrames: false` lands without showing a frame, like a player whose canvas
 * has gone, and `seekThrows` throws as setting the video's time to a non-finite one would.
 */
function fakePlayer({ showsFrames = true, seekThrows = false } = {}) {
  const pending: { target: number; landed: () => void }[] = []
  const asked: number[] = []
  const player = {
    time: 0,
    seek(target: number) {
      asked.push(target)
      pending.push({ target, landed: () => undefined })
    },
    seekAndWait(target: number) {
      asked.push(target)
      if (seekThrows) throw new TypeError('The provided double value is non-finite.')
      return new Promise<void>((landed) => pending.push({ target, landed }))
    },
    async grabFrame() {
      return { shownAt: player.time } as unknown as ImageBitmap
    }
  }
  return {
    player,
    asked,
    inFlight: () => pending.length,
    async land() {
      const seek = pending.shift()!
      player.time = seek.target
      if (showsFrames) setPlayhead(seek.target)
      seek.landed()
      await settle()
    }
  }
}

function attached(fake: ReturnType<typeof fakePlayer>) {
  attachPlayer(fake.player as unknown as RecordingPlayer)
  return fake
}

const storedTime = () => store.get().playback.time

beforeEach(() => {
  attachPlayer(null)
  store.set({ playback: { playing: false, time: 0 } })
  setPlayhead(0)
})

describe('scrubbing', () => {
  it('moves the playhead to the pointer at once, before the video gets there', () => {
    const fake = attached(fakePlayer())
    scrubTo(400)
    expect(currentPlayhead()).toBe(400)
    expect(fake.asked).toEqual([400])
  })

  it('keeps one seek in flight, always to the latest point', async () => {
    const fake = attached(fakePlayer())
    scrubTo(100)
    scrubTo(200)
    scrubTo(300)
    expect(fake.asked).toEqual([100])
    await fake.land()
    expect(fake.asked).toEqual([100, 300])
    expect(fake.inFlight()).toBe(1)
    await fake.land()
    expect(fake.asked).toEqual([100, 300])
    expect(fake.inFlight()).toBe(0)
  })

  it('never lets a frame for an older point pull the playhead back', async () => {
    const fake = attached(fakePlayer())
    scrubTo(100)
    scrubTo(300)
    await fake.land()
    expect(currentPlayhead()).toBe(300)
    expect(storedTime()).toBe(100)
  })

  it('ends with the playhead, the frame on screen and the store’s time agreeing', async () => {
    const fake = attached(fakePlayer())
    scrubTo(100)
    scrubTo(250)
    await fake.land()
    await fake.land()
    expect([currentPlayhead(), fake.player.time, storedTime()]).toEqual([250, 250, 250])
  })

  it('asks for no other seek when the pointer is back where the seek in flight goes', async () => {
    const fake = attached(fakePlayer())
    scrubTo(100)
    scrubTo(300)
    scrubTo(100)
    await fake.land()
    expect(fake.asked).toEqual([100])
    expect(fake.inFlight()).toBe(0)
    expect([currentPlayhead(), storedTime()]).toEqual([100, 100])
  })

  it('lets frames move the playhead again once the video has caught up', async () => {
    const fake = attached(fakePlayer())
    scrubTo(100)
    await fake.land()
    setPlayhead(140)
    expect(currentPlayhead()).toBe(140)
  })

  it('lets a new player’s frames move the playhead while the old player’s seek is still out', async () => {
    const old = attached(fakePlayer({ showsFrames: false }))
    scrubTo(100)
    scrubTo(300)
    attached(fakePlayer())
    setPlayhead(50)
    await old.land()
    expect(old.asked).toEqual([100])
    expect(currentPlayhead()).toBe(50)
  })

  it('moves the playhead and the store’s time together when there is no player', () => {
    scrubTo(250)
    expect([currentPlayhead(), storedTime()]).toEqual([250, 250])
  })

  it('lets frames move the playhead again after a seek throws, and reports the error', async () => {
    const failed = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fake = attached(fakePlayer({ seekThrows: true }))
    scrubTo(100)
    await settle()
    expect(failed).toHaveBeenCalledWith('Scrubbing failed', expect.any(TypeError))
    setPlayhead(140)
    expect(currentPlayhead()).toBe(140)
    scrubTo(200)
    await settle()
    expect(fake.asked).toEqual([100, 200])
    failed.mockRestore()
  })
})

describe('grabbing the frame at the playhead', () => {
  const grabbing = () => {
    const outcome: { frame?: ImageBitmap | null } = {}
    void grabPlayheadFrame().then((frame) => (outcome.frame = frame))
    return outcome
  }

  it('waits until the video has caught up with a scrub, so the frame is the one at the playhead', async () => {
    const fake = attached(fakePlayer())
    scrubTo(100)
    scrubTo(300)
    const grab = grabbing()
    await fake.land()
    expect(grab.frame).toBeUndefined()
    await fake.land()
    expect(grab.frame).toEqual({ shownAt: 300 })
    expect(currentPlayhead()).toBe(300)
  })

  it('grabs at once when no scrub is ahead of the video', async () => {
    const fake = attached(fakePlayer())
    fake.player.time = 120
    const grab = grabbing()
    await settle()
    expect(grab.frame).toEqual({ shownAt: 120 })
  })
})
