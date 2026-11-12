import { describe, expect, it } from 'vitest'
import { cameraViewMatrix, wideViewPoint } from '../src/renderer/src/recording/blur-boxes'
import { anchoredAt, drawnRect, movedRects, resizedRect } from '../src/renderer/src/recording/box-edit'
import { recordingEditLayout } from '../src/renderer/src/recording/edit-layout'
import { rect, transformPoint } from '../src/renderer/src/render/geometry'
import { outputToSource, sourceToOutput } from '../src/renderer/src/render/layout'
import { output, zoomScene } from './recording-scenes'

const { view, style, videoSize } = zoomScene
const frame = recordingEditLayout(view, videoSize, output, style)
const full = rect(0, 0, videoSize.width, videoSize.height)
const SOURCE_MS = 4000
const zoomedPoint = (videoPoint: { x: number; y: number }) =>
  transformPoint(cameraViewMatrix(view, output, style, SOURCE_MS), sourceToOutput(frame, videoPoint))

describe('a box pressed while the canvas shows the zoomed camera', () => {
  const box = rect(1200, 700, 300, 120)
  const pressedAt = zoomedPoint({ x: 1300, y: 760 })
  const start = wideViewPoint(pressedAt, false, view, output, style, SOURCE_MS)

  it('is pressed on the content the user aimed at', () => {
    const at = outputToSource(frame, start)
    expect(at.x).toBeCloseTo(1300, 6)
    expect(at.y).toBeCloseTo(760, 6)
  })

  it('moves by the pointer’s travel in the wide view from the switch on, with no jump', () => {
    const firstWide = { x: 700, y: 500 }
    const anchor = anchoredAt({ start, anchored: false }, firstWide, true)
    expect(anchor).toEqual({ start: firstWide, anchored: true })
    expect(movedRects([box], anchor.start, firstWide, frame, full)).toEqual([box])
    const later = { x: firstWide.x + 30, y: firstWide.y - 12 }
    const [moved] = movedRects([box], anchor.start, later, frame, full)
    expect(moved.x - box.x).toBeCloseTo(30 / frame.scale, 6)
    expect(moved.y - box.y).toBeCloseTo(-12 / frame.scale, 6)
  })

  it('keeps its press point while the canvas is not wide yet, and once anchored', () => {
    expect(anchoredAt({ start, anchored: false }, { x: 1, y: 2 }, false)).toEqual({ start, anchored: false })
    expect(anchoredAt({ start, anchored: true }, { x: 1, y: 2 }, true)).toEqual({ start, anchored: true })
  })
})

describe('a box drawn while the canvas shows the zoomed camera', () => {
  it('has the content under the press and the point under the wide pointer as its corners', () => {
    const start = wideViewPoint(zoomedPoint({ x: 1300, y: 760 }), false, view, output, style, SOURCE_MS)
    const pointer = sourceToOutput(frame, { x: 1100, y: 900 })
    const drawn = drawnRect(start, pointer, frame, full)
    expect(drawn.x).toBeCloseTo(1100, 6)
    expect(drawn.y).toBeCloseTo(760, 6)
    expect(drawn.w).toBeCloseTo(200, 6)
    expect(drawn.h).toBeCloseTo(140, 6)
  })
})

describe('resizing and clipping', () => {
  it('clips a box to the image', () => {
    const drawn = drawnRect(sourceToOutput(frame, { x: 100, y: 100 }), sourceToOutput(frame, { x: -500, y: 99999 }), frame, full)
    expect(drawn.x).toBe(0)
    expect(drawn.y + drawn.h).toBe(videoSize.height)
  })

  it('resizes by the pointer’s travel in image px', () => {
    const start = { x: 500, y: 500 }
    const resized = resizedRect(rect(100, 100, 200, 100), 'se', start, { x: 500 + frame.scale * 40, y: 500 }, frame, full)
    expect(resized.w).toBeCloseTo(240, 6)
  })
})
