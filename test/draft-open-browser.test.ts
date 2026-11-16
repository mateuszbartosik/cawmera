import { describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }) }))

type FakeElement = Record<string, unknown> & { tag: string }
const elements: FakeElement[] = []
vi.stubGlobal('document', {
  createElement: (tag: string) => {
    const element: FakeElement = { tag, click: vi.fn() }
    elements.push(element)
    return element
  }
})

const { draftAmong, openDraft, openDraftAmong } = await import('../src/renderer/src/drafts/actions')
const { loadFiles, openFilePicker } = await import('../src/renderer/src/app/actions')
const { isDesktop } = await import('../src/renderer/src/platform/bridge')

describe('the browser build', () => {
  it('has no drafts: the picker takes images only, and no file counts as a draft', async () => {
    expect(isDesktop).toBe(false)
    const draft = new File(['draft'], 'Launch.cawmera')
    expect(draftAmong([draft])).toBeUndefined()
    expect(openDraftAmong([draft])).toBeNull()
    expect(await openDraft(null)).toBe(false)

    openFilePicker()
    const input = elements.find((element) => element.tag === 'input')!
    expect(input.accept).toBe('image/png,image/jpeg,image/webp,image/gif,image/bmp')
    input.files = [draft]
    ;(input.onchange as () => void)()
    expect(toast.error).toHaveBeenCalledWith('Cawmera can’t open this file', { description: 'It opens images.' })
  })

  it('says it can’t open several files, and that it opens images', async () => {
    vi.mocked(toast.error).mockClear()
    await loadFiles([new File([''], 'notes.png.txt', { type: 'text/plain' }), new File([''], 'Launch.cawmera')], 'drop')
    expect(toast.error).toHaveBeenCalledWith('Cawmera can’t open these files', { description: 'It opens images.' })
  })
})
