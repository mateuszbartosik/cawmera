export const LABEL_WIDTH = 56
export const SIDE_PADDING = 12
export const BODY_PADDING = 4
export const RULER_HEIGHT = 24
export const CLIP_HEIGHT = 44
export const CLIP_INSET = 4

/** Nothing on the timeline is text anyone copies, so no drag across it selects any; while not editable it's inert and dimmed. */
export const timelineSurface = (editable: boolean) => (editable ? 'select-none' : 'select-none pointer-events-none opacity-50')
