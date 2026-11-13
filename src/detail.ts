import type { Detail } from './backdrop'
import type { MapMode, MapStyle } from './model'
import type { View } from './paint'

/**
 * Sharper satellite imagery for the part of the map being looked at. The
 * images bundled with the app cover the whole world and turn blurry a few zoom
 * steps in; from there on, tiles of the same pictures are fetched from NASA's
 * public imagery service (GIBS) for just the visible area.
 */

const SERVICE = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best'
const LAYERS: Record<Exclude<MapStyle, 'plain'>, string> = {
  terrain: 'BlueMarble_ShadedRelief_Bathymetry',
  night: 'VIIRS_CityLights_2012',
}
const TILE = 512
/** Degrees covered by one tile at level 0; each level halves it. */
const SPAN = 288
// below level 3 tiles overhang the edge of the world; above 7 there is no imagery
const MIN_LEVEL = 3
const MAX_LEVEL = 7
/** Most tiles along one side: keeps the stitched image within every phone's texture limit. */
const MAX_SIDE = 8
/** Pixels per degree of the bundled world images; no point fetching anything coarser. */
const BUNDLED = 4096 / 360

const images = new Map<string, Promise<HTMLImageElement | null>>()
function tile(url: string) {
  let pending = images.get(url)
  if (!pending) {
    pending = new Promise((done) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => done(image)
      image.onerror = () => {
        images.delete(url) // allow another try later
        done(null)
      }
      image.src = url
    })
    images.set(url, pending)
    if (images.size > 400) images.delete(images.keys().next().value!)
  }
  return pending
}

export function createDetailLoader(onChange: (detail: Detail | null) => void) {
  let wanted = ''

  return {
    /** Call when the view has come to rest; fetches what it needs and reports back through onChange. */
    want(style: MapStyle, mode: MapMode, view: View, w: number, h: number, scale: number, dpr: number) {
      const perDegree = (scale * dpr * Math.PI) / 180
      if (style === 'plain' || perDegree < BUNDLED * 1.25) {
        if (wanted) onChange(null)
        wanted = ''
        return
      }

      // the area worth sharpening: what is on screen, but never more than the
      // middle of the globe, where the surface faces the viewer
      const reach = Math.hypot(w, h) / 2 / scale
      const cap = mode === 'globe' ? (reach >= 1 ? 90 : (Math.asin(reach) * 180) / Math.PI) : 0
      const latHalf = Math.min(35, mode === 'globe' ? cap : ((h / 2 / scale) * 180) / Math.PI)
      const shrink = Math.max(0.3, Math.cos((Math.min(80, Math.abs(view.lat) + latHalf) * Math.PI) / 180))
      const lngHalf = Math.min(60, mode === 'globe' ? cap / shrink : ((w / 2 / scale) * 180) / Math.PI / 0.75)
      const south = Math.max(-90, view.lat - latHalf)
      const north = Math.min(90, view.lat + latHalf)

      let level = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.ceil(Math.log2((perDegree * SPAN) / TILE) - 0.35)))
      let span = 0
      let x0 = 0
      let x1 = 0
      let y0 = 0
      let y1 = 0
      for (; ; level--) {
        span = SPAN / 2 ** level
        x0 = Math.floor((view.lng - lngHalf + 180) / span)
        x1 = Math.floor((view.lng + lngHalf + 180) / span)
        y0 = Math.max(0, Math.floor((90 - north) / span))
        y1 = Math.min(Math.round(180 / span) - 1, Math.floor((90 - south) / span))
        if (level === MIN_LEVEL || (x1 - x0 < MAX_SIDE && y1 - y0 < MAX_SIDE)) break
      }
      x1 = Math.min(x1, x0 + MAX_SIDE - 1)
      y1 = Math.min(y1, y0 + MAX_SIDE - 1)

      const key = [style, level, x0, x1, y0, y1].join('|')
      if (key === wanted) return
      wanted = key

      const columns = Math.round(360 / span)
      const jobs: Promise<{ image: HTMLImageElement | null; x: number; y: number }>[] = []
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const column = ((x % columns) + columns) % columns // the globe wraps round
          const url = `${SERVICE}/${LAYERS[style]}/default/500m/${level}/${y}/${column}.jpeg`
          jobs.push(tile(url).then((image) => ({ image, x: x - x0, y: y - y0 })))
        }
      }
      Promise.all(jobs).then((tiles) => {
        if (wanted !== key) return // the view moved on while these were loading
        const sheet = document.createElement('canvas')
        sheet.width = (x1 - x0 + 1) * TILE
        sheet.height = (y1 - y0 + 1) * TILE
        const ctx = sheet.getContext('2d')!
        // tiles that failed to load stay transparent and the bundled image shows there
        for (const t of tiles) if (t.image) ctx.drawImage(t.image, t.x * TILE, t.y * TILE, TILE, TILE)
        const west = x0 * span - 180
        onChange({
          style,
          image: sheet,
          west: ((((west + 180) % 360) + 360) % 360) - 180,
          north: 90 - y0 * span,
          width: (x1 - x0 + 1) * span,
          height: (y1 - y0 + 1) * span,
        })
      })
    },
  }
}
