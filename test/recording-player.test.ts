import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HAVE_NOTHING = 0
const HAVE_CURRENT_DATA = 2

class FakeVideo extends EventTarget {
  muted = false
  preload = ''
  playsInline = false
  crossOrigin: string | null = null
  src = ''
  currentTime = 0
  playbackRate = 1
  paused = true
  seeking = false
  readyState = HAVE_CURRENT_DATA
  removeAttribute() {
    this.src = ''
  }
  load() {
    this.readyState = HAVE_NOTHING
    this.seeking = false
  }
  pause() {}
}

let video: FakeVideo
vi.stubGlobal('document', {
  createElement: () => {
    video = new FakeVideo()
    return video
  }
})
vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA })
const frame = { width: 1920, height: 1080, close: vi.fn() } as unknown as ImageBitmap
vi.stubGlobal('createImageBitmap', vi.fn(async () => frame))

const { RecordingPlayer } = await import('../src/renderer/src/recording/player')

/** The grab, and what it gave once it ended: undefined while it still waits. */
function grabbing(player: InstanceType<typeof RecordingPlayer>) {
  const outcome: { frame?: ImageBitmap | null } = {}
  void player.grabFrame().then((grabbed) => (outcome.frame = grabbed))
  return outcome
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('grabbing the frame on screen', () => {
  it('waits for a seek to settle, then grabs the frame', async () => {
    const player = new RecordingPlayer('cawmera-media://recording/take', 60)
    video.seeking = true
    const grab = grabbing(player)
    await vi.advanceTimersByTimeAsync(500)
    expect(grab.frame).toBeUndefined()
    video.seeking = false
    video.dispatchEvent(new Event('seeked'))
    await vi.advanceTimersByTimeAsync(0)
    expect(grab.frame).toBe(frame)
  })

  it('stops waiting for a seek that never settles after a second, and grabs only a frame that is there', async () => {
    const player = new RecordingPlayer('cawmera-media://recording/take', 60)
    video.seeking = true
    const withFrame = grabbing(player)
    await vi.advanceTimersByTimeAsync(999)
    expect(withFrame.frame).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(withFrame.frame).toBe(frame)

    video.readyState = HAVE_NOTHING
    const withoutFrame = grabbing(player)
    await vi.advanceTimersByTimeAsync(1000)
    expect(withoutFrame.frame).toBeNull()
  })

  it('stops waiting when the player goes away', async () => {
    const player = new RecordingPlayer('cawmera-media://recording/take', 60)
    video.seeking = true
    const grab = grabbing(player)
    player.dispose()
    await vi.advanceTimersByTimeAsync(0)
    expect(grab.frame).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('seeking for a scrub', () => {
  it('waits for the seek to land, or a second at most', async () => {
    const player = new RecordingPlayer('cawmera-media://recording/take', 60)
    const landing: { done?: boolean } = {}
    void player.seekAndWait(1500).then(() => (landing.done = true))
    expect(video.currentTime).toBe(1.5)
    await vi.advanceTimersByTimeAsync(500)
    expect(landing.done).toBeUndefined()
    video.dispatchEvent(new Event('seeked'))
    await vi.advanceTimersByTimeAsync(0)
    expect(landing.done).toBe(true)

    const stuck: { done?: boolean } = {}
    void player.seekAndWait(2500).then(() => (stuck.done = true))
    await vi.advanceTimersByTimeAsync(999)
    expect(stuck.done).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(stuck.done).toBe(true)
  })
})
