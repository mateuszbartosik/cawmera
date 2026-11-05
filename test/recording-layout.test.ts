import { describe, expect, it } from 'vitest'
import { DEFAULT_HOUSE_STYLE } from '../src/renderer/src/app/house-style'
import { drawFrameShadow } from '../src/renderer/src/render/compose'
import { recordingLayout } from '../src/renderer/src/recording/layout'
import { fakeContext } from './fake-canvas'

describe('recordingLayout', () => {
  it('fits the video inside the inset on every side, centred', () => {
    const layout = recordingLayout({ width: 2560, height: 1440 }, { width: 1920, height: 1080 }, { inset: 96 })
    expect(layout.content).toEqual({ x: 171, y: 96, w: 1579, h: 888 })
    expect(layout.scale).toBeCloseTo(888 / 1440)
  })

  it('fits by height when the video is taller than the output ratio', () => {
    const { content } = recordingLayout({ width: 1000, height: 1000 }, { width: 1920, height: 1080 }, { inset: 96 })
    expect(content.h).toBe(888)
    expect(content.x).toBe(516)
  })

  it('never scales a small video up', () => {
    expect(recordingLayout({ width: 800, height: 500 }, { width: 1920, height: 1080 }, { inset: 96 })).toEqual({
      content: { x: 560, y: 290, w: 800, h: 500 },
      scale: 1
    })
  })
})

describe('drawFrameShadow', () => {
  it('draws the house shadow from the shared helper', () => {
    const a = fakeContext()
    drawFrameShadow(a.ctx, { x: 0, y: 0, w: 100, h: 50 }, 20, DEFAULT_HOUSE_STYLE, 1)
    expect(a.calls).toContain('shadowBlur=80')
    expect(a.calls).toContain('shadowOffsetY=28')
    expect(a.calls).toContain(`shadowColor=rgba(0, 0, 0, ${DEFAULT_HOUSE_STYLE.shadow})`)
  })
})
