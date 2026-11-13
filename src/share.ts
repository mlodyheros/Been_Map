import { STRINGS, type Lang } from './i18n'
import { PEOPLE_COLOR, STATUSES, landShareLabel, type MapStyle, type Stats } from './model'

const W = 1600
const H = 2000

/** Composes a shareable poster around a globe snapshot and downloads it as PNG. */
export async function downloadPoster(globe: HTMLCanvasElement, stats: Stats, lang: Lang, style: MapStyle) {
  const dark = style !== 'plain'
  const ink = dark ? '#FFFFFF' : '#141833'
  const t = STRINGS[lang]
  await document.fonts.ready
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = dark ? '#070A18' : '#F1F2F7'
  ctx.fillRect(0, 0, W, H)
  ctx.drawImage(globe, 0, 150, W, W)

  ctx.fillStyle = ink
  ctx.textBaseline = 'alphabetic'
  ctx.font = '700 44px Unbounded, sans-serif'
  ctx.fillText('been map', 110, 150)

  ctx.font = '700 190px Unbounded, sans-serif'
  const count = String(stats.been)
  ctx.fillText(count, 104, H - 190)
  const after = 104 + ctx.measureText(count).width + 36
  ctx.font = '500 52px Onest, sans-serif'
  ctx.fillText(t.countries(stats.been), after, H - 262)
  ctx.fillStyle = dark ? '#A9B1D6' : '#5D6485'
  ctx.fillText(t.landShare(landShareLabel(stats.landShare)), after, H - 194)

  ctx.font = '500 30px Onest, sans-serif'
  let x = 110
  for (const s of [...STATUSES, { id: 'people' as const, color: PEOPLE_COLOR }]) {
    const label = t.brush[s.id]
    ctx.fillStyle = s.color
    ctx.beginPath()
    ctx.arc(x + 12, H - 102, 12, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = ink
    ctx.fillText(label, x + 36, H - 92)
    x += ctx.measureText(label).width + 78
  }

  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'))
  if (!blob) return
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = 'been-map.png'
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}
