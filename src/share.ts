import { STRINGS, type Lang } from './i18n'
import { PEOPLE_COLOR, STATUSES, landShareLabel, type MapStyle, type Stats } from './model'

/** Story fills a phone screen (Instagram, WhatsApp status…); post is the 4:5 feed format. */
export type ShareFormat = 'story' | 'post'
export const SHARE_FORMATS: ShareFormat[] = ['story', 'post']

const SIZES: Record<ShareFormat, [number, number]> = { story: [1080, 1920], post: [1080, 1350] }
// everything is laid out on a 1600-wide sheet and scaled to the output size
const SHEET = 1600

/** Composes a shareable card around a square map snapshot. */
export async function renderCard(
  globe: HTMLCanvasElement,
  stats: Stats,
  lang: Lang,
  style: MapStyle,
  format: ShareFormat,
): Promise<Blob | null> {
  const t = STRINGS[lang]
  const dark = style !== 'plain'
  const ink = dark ? '#FFFFFF' : '#141833'
  await document.fonts.ready
  const [width, height] = SIZES[format]
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const k = width / SHEET
  ctx.scale(k, k)
  const H = height / k
  // apps draw their own buttons over the top and bottom of a story
  const top = format === 'story' ? 270 : 0
  const bottom = H - (format === 'story' ? 370 : 0)

  ctx.fillStyle = dark ? '#070A18' : '#F1F2F7'
  ctx.fillRect(0, 0, SHEET, H)
  ctx.drawImage(globe, 0, top + 150 + (bottom - top - 2000) / 2, SHEET, SHEET)

  ctx.fillStyle = ink
  ctx.textBaseline = 'alphabetic'
  ctx.font = '700 44px Unbounded, sans-serif'
  ctx.fillText('been map', 110, top + 150)

  ctx.font = '700 190px Unbounded, sans-serif'
  const count = String(stats.been)
  ctx.fillText(count, 104, bottom - 190)
  const after = 104 + ctx.measureText(count).width + 36
  ctx.font = '500 52px Onest, sans-serif'
  ctx.fillText(t.countries(stats.been), after, bottom - 262)
  ctx.fillStyle = dark ? '#A9B1D6' : '#5D6485'
  ctx.fillText(t.landShare(landShareLabel(stats.landShare)), after, bottom - 194)

  ctx.font = '500 30px Onest, sans-serif'
  let x = 110
  for (const s of [...STATUSES, { id: 'people' as const, color: PEOPLE_COLOR }]) {
    const label = t.brush[s.id]
    ctx.fillStyle = s.color
    ctx.beginPath()
    ctx.arc(x + 12, bottom - 102, 12, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = ink
    ctx.fillText(label, x + 36, bottom - 92)
    x += ctx.measureText(label).width + 78
  }

  return new Promise((done) => canvas.toBlob(done, 'image/png'))
}

export const cardFile = (blob: Blob) => new File([blob], 'been-map.png', { type: 'image/png' })

/** True when this browser can hand an image to other apps (phones, mostly). */
export const canShareFiles = (blob: Blob) =>
  typeof navigator.canShare === 'function' && navigator.canShare({ files: [cardFile(blob)] })

export function downloadCard(blob: Blob) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = 'been-map.png'
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}
