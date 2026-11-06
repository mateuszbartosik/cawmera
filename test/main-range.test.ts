import { describe, expect, it } from 'vitest'
import { mediaReply, parseRange } from '../src/main/range'

it('parses ranges', () => {
  expect(parseRange(null, 1000)).toBeNull()
  expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
  expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 })
  expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
  expect(parseRange('bytes=2000-', 1000)).toBe('unsatisfiable')
  expect(parseRange('items=0-1', 1000)).toBeNull()
})

it('clamps an end past the file and rejects reversed or empty ranges', () => {
  expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 })
  expect(parseRange('bytes=500-100', 1000)).toBe('unsatisfiable')
  expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable')
  expect(parseRange('bytes=0-1', 0)).toBe('unsatisfiable')
  expect(parseRange('bytes=abc', 1000)).toBeNull()
})

describe('mediaReply', () => {
  const cors = { 'Access-Control-Allow-Origin': '*' }
  const exposed = 'Content-Range, Accept-Ranges, Content-Length'

  it('serves the whole file with 200', () => {
    const reply = mediaReply('GET', null, 1000)
    expect(reply).toMatchObject({ status: 200, range: { start: 0, end: 999 }, headers: { ...cors, 'Content-Length': '1000', 'Accept-Ranges': 'bytes' } })
    expect(reply.headers['Access-Control-Expose-Headers']).toBe(exposed)
    expect(reply.headers['Content-Range']).toBeUndefined()
  })

  it('serves a range with 206, Content-Range and Content-Length', () => {
    const reply = mediaReply('GET', 'bytes=-100', 1000)
    expect(reply).toMatchObject({ status: 206, range: { start: 900, end: 999 }, headers: { ...cors, 'Content-Range': 'bytes 900-999/1000', 'Content-Length': '100' } })
    expect(reply.headers['Access-Control-Expose-Headers']).toBe(exposed)
  })

  it('answers an unsatisfiable range with 416', () => {
    const reply = mediaReply('GET', 'bytes=2000-', 1000)
    expect(reply).toMatchObject({ status: 416, range: null, headers: { ...cors, 'Content-Range': 'bytes */1000', 'Accept-Ranges': 'bytes' } })
    expect(reply.headers['Access-Control-Expose-Headers']).toBe(exposed)
  })

  it('answers a missing file with 404 and the CORS headers', () => {
    const reply = mediaReply('GET', null, null)
    expect(reply).toMatchObject({ status: 404, range: null, headers: { ...cors } })
    expect(reply.headers['Access-Control-Expose-Headers']).toBe(exposed)
  })

  it('answers a preflight with 204', () => {
    expect(mediaReply('OPTIONS', 'bytes=0-1', 1000)).toMatchObject({
      status: 204,
      headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': 'Range' }
    })
  })
})
