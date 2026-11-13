import { DEFAULT_SIZE } from './size'

/**
 * The locked look of every image. People taking screenshots never see these controls; a designer
 * can open View → House style, tune them, and share the result as a JSON file that others import.
 */

/** Export px per CSS px when an image is shown at half its pixel width, which is the canvas's 100%. */
export const EXPORT_DENSITY = 2

export interface HouseStyle {
  /** Shown when the style is imported, so people know which one they have. */
  name: string
  /**
   * The width (CSS px) the image is designed to be shown at. At 100% UI zoom the captured UI appears
   * at its real size when the image is displayed this wide. 800 keeps Retina captures pixel-exact.
   */
  designWidth: number
  /** Plate gradient: the lit side and the far side. Each shot picks the direction the light comes from. */
  plateFrom: string
  plateTo: string
  /** Default light colour and strength (100% intensity) for new shots. */
  glow: string
  glowStrength: number
  /** Distance of a bleeding screenshot from the top and left edge, in export px. */
  inset: number
  radius: number
  shadow: number
  border: number
  /** Spotlight outline colour. */
  accent: string
  /** The image shots set to Image fill their background with, as a data URL, so it travels in the file. */
  backgroundImage: string | null
}

/** A neutral studio look: graphite plate, soft white light. Brands bring their own as a JSON file. */
export const DEFAULT_HOUSE_STYLE: HouseStyle = {
  name: 'Default',
  designWidth: 800,
  plateFrom: '#272B34',
  plateTo: '#0B0C10',
  glow: '#E3E9F5',
  glowStrength: 0.24,
  inset: 96,
  radius: 20,
  shadow: 0.55,
  border: 0.14,
  accent: '#FFFFFF',
  backgroundImage: null
}

const HEX = /^#[0-9a-f]{6}$/i
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif|bmp);base64,[A-Za-z0-9+/]+={0,2}$/
/** About 12 MB of image, far above what Cawmera itself stores (see backdrop.ts). */
const MAX_IMAGE_URL_LENGTH = 16_000_000

/**
 * Format of a stored or exported house style. 2: 100% light intensity is what 1 called 200%.
 * 3: it can carry a background image.
 */
export const HOUSE_STYLE_VERSION = 3

/** A stored or imported house style (any format version), upgraded to the current one. */
export function loadHouseStyle(input: unknown): HouseStyle {
  const source: Record<string, unknown> = input && typeof input === 'object' ? { ...(input as Record<string, unknown>) } : {}
  const version = typeof source.version === 'number' ? source.version : 1
  if (version < 2 && typeof source.glowStrength === 'number') source.glowStrength *= 2
  return sanitizeHouseStyle(source)
}

/** What gets stored or exported: the style plus its format version. */
export const serializeHouseStyle = (style: HouseStyle) => ({ version: HOUSE_STYLE_VERSION, ...style })

/** The toast for a style that replaced the current one, imported on its own or with a draft. */
export const houseStyleImported = (style: HouseStyle) => (style.name ? `${style.name} house style imported` : 'House style imported')

/**
 * Export px per CSS px of the captured UI at 100% UI zoom. The same in every image size: the design
 * width says how wide a default 1600 px image is shown.
 */
export const uiScale = (style: Pick<HouseStyle, 'designWidth'>) => DEFAULT_SIZE.width / style.designWidth

/** Accepts a partial or untrusted object (imported JSON, storage) and returns a valid style. */
export function sanitizeHouseStyle(input: unknown): HouseStyle {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const color = (key: keyof HouseStyle) => {
    const value = source[key]
    return typeof value === 'string' && HEX.test(value) ? value.toUpperCase() : (DEFAULT_HOUSE_STYLE[key] as string)
  }
  const number = (key: keyof HouseStyle, min: number, max: number) => {
    const value = source[key]
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : (DEFAULT_HOUSE_STYLE[key] as number)
  }
  const name = typeof source.name === 'string' ? source.name.trim().slice(0, 40) : ''
  const image = source.backgroundImage
  const backgroundImage = typeof image === 'string' && image.length <= MAX_IMAGE_URL_LENGTH && IMAGE_DATA_URL.test(image) ? image : null
  return {
    name,
    designWidth: Math.round(number('designWidth', 480, 1000)),
    plateFrom: color('plateFrom'),
    plateTo: color('plateTo'),
    glow: color('glow'),
    glowStrength: number('glowStrength', 0, 1),
    inset: number('inset', 32, 200),
    radius: number('radius', 0, 48),
    shadow: number('shadow', 0, 1),
    border: number('border', 0, 0.5),
    accent: color('accent'),
    backgroundImage
  }
}
