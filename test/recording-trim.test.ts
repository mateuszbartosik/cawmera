import { describe, expect, it } from 'vitest'
import { autoTrim, clampTrim } from '../src/renderer/src/recording/trim'
import type { Click, CursorSample, RecordingTrack } from '../src/renderer/src/recording/track'

const still = (from: number, to: number, x = 800): CursorSample[] =>
  Array.from({ length: Math.floor((to - from) / 16) }, (_, i) => ({ t: from + i * 16, x, y: 400, shape: 'arrow' as const }))
const track = (cursor: CursorSample[], durationMs: number, clicks: Click[] = []): RecordingTrack =>
  ({ kind: 'monitor', width: 1920, height: 1080, fps: 60, durationMs, scale: 1, cursor, clicks })

describe('auto trim', () => {
  it('cuts the shortcut press when the cursor rests until the end', () => {
    expect(autoTrim(track(still(0, 5000), 5000))).toEqual({ start: 0, end: 4800 })
  })

  it('cuts the final trip to the taskbar', () => {
    const trip = Array.from({ length: 50 }, (_, i) => ({ t: 4000 + i * 16, x: 800 + i * 20, y: 400 + i * 12, shape: 'arrow' as const }))
    expect(autoTrim(track([...still(2000, 4000), ...trip], 4800)).end).toBe(4000)
  })

  it('keeps the end when a click follows the last rest', () => {
    const moves = Array.from({ length: 50 }, (_, i) => ({ t: 4000 + i * 16, x: 800 + i * 20, y: 400, shape: 'arrow' as const }))
    const clicks: Click[] = [{ t: 4700, x: 1700, y: 400, button: 'left', up: 4750 }]
    expect(autoTrim(track([...still(2000, 4000), ...moves], 4800, clicks)).end).toBe(4800)
  })

  it('ignores clicks outside the frame after the last rest', () => {
    const trip = Array.from({ length: 50 }, (_, i) => ({ t: 4000 + i * 16, x: 800 + i * 30, y: 400, shape: 'arrow' as const }))
    const outside: Click[] = [{ t: 4700, x: 2200, y: 400, button: 'left', up: 4750 }]
    expect(autoTrim(track([...still(2000, 4000), ...trip], 4800, outside)).end).toBe(4000)
  })

  it('keeps everything when the cursor never rests', () => {
    const moves = Array.from({ length: 100 }, (_, i) => ({ t: i * 16, x: 100 + i * 10, y: 400, shape: 'arrow' as const }))
    expect(autoTrim(track(moves, 1600))).toEqual({ start: 0, end: 1600 })
  })

  it('never returns an empty or inverted range for very short recordings', () => {
    expect(autoTrim(track(still(0, 300), 300))).toEqual({ start: 0, end: 300 })
    expect(clampTrim({ start: 900, end: 100 }, 1000)).toEqual({ start: 0, end: 1000 })
    expect(clampTrim({ start: 200, end: 400 }, 5000)).toEqual({ start: 200, end: 700 })
  })
})

describe('auto trim of a take stopped from the taskbar', () => {
  interface Spot { x: number; y: number }
  const content: Spot = { x: 800, y: 400 }
  const button: Spot = { x: 900, y: 1060 }
  const thumbnail: Spot = { x: 900, y: 910 }
  const stay = (at: Spot, from: number, to: number) => still(from, to).map((sample) => ({ ...sample, ...at }))
  const glide = (from: Spot, to: Spot, startMs: number, count = 30): CursorSample[] =>
    Array.from({ length: count }, (_, i) => ({
      t: startMs + i * 16,
      x: from.x + ((to.x - from.x) * i) / count,
      y: from.y + ((to.y - from.y) * i) / count,
      shape: 'arrow' as const
    }))
  const stopClickOn = (at: Spot): Click => ({ t: 4900, ...at, button: 'left', up: null })

  it('cuts the wait on Cawmera’s taskbar button along with the trip there', () => {
    const cursor = [...stay(content, 2000, 4000), ...glide(content, button, 4000), ...stay(button, 4480, 5000)]
    expect(autoTrim(track(cursor, 5000), stopClickOn(button)).end).toBe(4000)
  })

  it('cuts a wait outside the frame the same way', () => {
    const belowFrame: Spot = { x: 900, y: 1150 }
    const cursor = [...stay(content, 2000, 4000), ...glide(content, belowFrame, 4000), ...stay(belowFrame, 4480, 5000)]
    expect(autoTrim(track(cursor, 5000), stopClickOn(belowFrame)).end).toBe(4000)
  })

  it('cuts a wait on the button that ends with a click on its thumbnail', () => {
    const cursor = [
      ...stay(content, 2000, 4000),
      ...glide(content, button, 4000),
      ...stay(button, 4480, 4800),
      ...glide(button, thumbnail, 4800, 5),
      ...stay(thumbnail, 4880, 5000)
    ]
    expect(autoTrim(track(cursor, 5000), stopClickOn(thumbnail)).end).toBe(4000)
  })

  it('ends where the cursor left its last rest, even when that rest was just outside the wait', () => {
    const outsideWait: Spot = { x: 900, y: 840 }
    const cursor = [...stay(outsideWait, 2000, 4000), ...stay(button, 4000, 5000)]
    expect(autoTrim(track(cursor, 5000), stopClickOn(button)).end).toBe(3984)
  })

  describe('after waiting on the button for its thumbnail', () => {
    const popup: Spot = { x: 900, y: 900 }
    const waitThenThumbnail = (waitMs: number) => [
      ...stay(content, 2000, 4000),
      ...glide(content, button, 4000),
      ...stay(button, 4480, 4480 + waitMs),
      ...glide(button, popup, 4480 + waitMs, 10),
      ...stay(popup, 4640 + waitMs, 4880 + waitMs)
    ]
    const clickOnPopup = (waitMs: number): Click => ({ t: 4780 + waitMs, ...popup, button: 'left', up: null })
    const maximizedWindow = (cursor: CursorSample[], durationMs: number): RecordingTrack =>
      ({ ...track(cursor, durationMs), kind: 'window', height: 1040 })

    it('cuts a 3 s wait and the thumbnail click on a monitor take', () => {
      expect(autoTrim(track(waitThenThumbnail(3000), 7900), clickOnPopup(3000)).end).toBe(4000)
    })
    it('cuts the same wait on a maximized window, whose frame holds the thumbnail', () => {
      expect(autoTrim(maximizedWindow(waitThenThumbnail(3000), 7900), clickOnPopup(3000)).end).toBe(4000)
    })
    it('keeps a stay of more than 5 s near the button as content', () => {
      expect(autoTrim(track(waitThenThumbnail(5600), 10_500), clickOnPopup(5600)).end).toBe(clickOnPopup(5600).t)
    })
  })

  describe('when the trip starts right after a content click', () => {
    const clicked: Spot = { x: 900, y: 300 }
    const outsideWait: Spot = { x: 900, y: 840 }
    const click: Click = { t: 2480, ...clicked, button: 'left', up: 2560 }

    it('lets the click land, ending 650 ms after it', () => {
      const cursor = [...glide({ x: 700, y: 300 }, clicked, 2000), ...glide(clicked, outsideWait, 2480, 60), ...stay(button, 3440, 5000)]
      expect(autoTrim(track(cursor, 5000, [click]), stopClickOn(button)).end).toBe(2480 + 650)
    })

    it('ends where the wait starts if that comes sooner', () => {
      const cursor = [...glide({ x: 700, y: 300 }, clicked, 2000), ...glide(clicked, outsideWait, 2480, 32), ...stay(button, 3000, 5000)]
      expect(autoTrim(track(cursor, 5000, [click]), stopClickOn(button)).end).toBe(3000)
    })

    it('lets the click land even when a short rest ended just after it', () => {
      const restingClick: Click = { ...click, t: 2500 }
      const cursor = [...stay(clicked, 2000, 2600), ...glide(clicked, outsideWait, 2600, 60), ...stay(button, 3560, 5000)]
      expect(autoTrim(track(cursor, 5000, [restingClick]), stopClickOn(button)).end).toBe(2500 + 650)
    })
  })

  describe('when the cursor stays near the button before the stop', () => {
    const nearButton: Spot = { x: 900, y: 910 }
    const arriving = [...stay(content, 0, 2000), ...glide(content, nearButton, 2000)]
    const clickNearButton = (t: number): Click => ({ t, ...nearButton, button: 'left', up: t + 80 })

    it('keeps a stay of more than 5 s as content, like typing in a chat box above the button', () => {
      const chatBox: Spot = { x: 900, y: 880 }
      const cursor = [
        ...stay(content, 0, 2000),
        ...glide(content, chatBox, 2000),
        ...stay(chatBox, 2480, 19_500),
        ...glide(chatBox, button, 19_500, 15),
        ...stay(button, 19_740, 20_200)
      ]
      const typing = { ...track(cursor, 20_200, [{ t: 2500, ...chatBox, button: 'left', up: 2580 }]), scale: 1.5 }
      expect(autoTrim(typing, { ...stopClickOn(button), t: 20_000 }).end).toBe(20_000)
    })

    it('lets a content click inside the wait land', () => {
      const cursor = [...arriving, ...stay(nearButton, 2480, 3200), ...glide(nearButton, button, 3200, 15), ...stay(button, 3440, 4200)]
      expect(autoTrim(track(cursor, 4200, [clickNearButton(2500)]), { ...stopClickOn(button), t: 4000 }).end).toBe(2500 + 650)
    })

    it('never lets that landing reach the stop click', () => {
      const cursor = [...arriving, ...stay(nearButton, 2480, 3700), ...glide(nearButton, button, 3700, 10), ...stay(button, 3860, 4200)]
      expect(autoTrim(track(cursor, 4200, [clickNearButton(3600)]), { ...stopClickOn(button), t: 4000 }).end).toBe(4000)
    })
  })
})
