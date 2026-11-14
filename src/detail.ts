import type { Detail } from './backdrop'
import type { MapMode, MapStyle } from './model'
import type { View } from './paint'

/**
 * Sharper imagery for the part of the map being looked at. The images bundled
 * with the app cover the whole world and turn blurry a few zoom steps in; from
 * there on, tiles of the same pictures, and of finely shaded relief, are
 * fetched from NASA's public imagery service (GIBS) for just the visible area.
 */

const SERVICE = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best'
/** A set of tiles on the service: its name, its grid, and the deepest level it has. */
interface Source {
  path: string
  deepest: number
}
const PICTURE: Partial<Record<MapStyle, Source>> = {
  terrain: { path: 'BlueMarble_ShadedRelief_Bathymetry/default/500m', deepest: 7 },
  night: { path: 'VIIRS_CityLights_2012/default/500m', deepest: 7 },
}
/** Shaded relief, far finer than the photos; laid over them once they run out of detail. */
const RELIEF: Source = { path: 'ASTER_GDEM_Greyscale_Shaded_Relief/default/31.25m', deepest: 11 }
/** Styles that get the relief, and the level from which it is worth fetching. */
const RELIEF_FROM: Partial<Record<MapStyle, number>> = { terrain: 6, relief: 3 }
const TILE = 512
/** Degrees covered by one tile at level 0; each level halves it. */
const SPAN = 288
// below level 3 tiles overhang the edge of the world
const MIN_LEVEL = 3
/** Most tiles along one side: keeps the stitched image within every phone's texture limit. */
const MOST_TILES = 8
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

interface Range {
  style: MapStyle
  level: number
  x0: number
  x1: number
  y0: number
  y1: number
}

const covers = (a: Range | null, b: Range) =>
  !!a && a.style === b.style && a.level === b.level && a.x0 <= b.x0 && a.x1 >= b.x1 && a.y0 <= b.y0 && a.y1 >= b.y1

export function createDetailLoader(onChange: (detail: Detail | null) => void) {
  let wanted = ''
  /** What the layer shows now, so a small move that stays inside it fetches nothing. */
  let shown: (Range & { detail: Detail }) | null = null

  return {
    /** Forgets what is on screen, so the next call fetches it again (the graphics context was rebuilt). */
    reset() {
      wanted = ''
      shown = null
    },
    /** Call when the view has come to rest; fetches what it needs and reports back through onChange. */
    want(style: MapStyle, mode: MapMode, view: View, w: number, h: number, scale: number, dpr: number) {
      const perDegree = (scale * dpr * Math.PI) / 180
      // no more tiles than the screen can show, plus a little: big pictures cost a phone dearly
      const MAX_SIDE = Math.max(5, Math.min(MOST_TILES, Math.ceil((Math.max(w, h) * dpr) / TILE) + 3))
      if (style === 'plain' || perDegree < BUNDLED * 1.25) {
        if (wanted) onChange(null)
        wanted = ''
        shown = null
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

      const picture = PICTURE[style]
      const reliefFrom = RELIEF_FROM[style]
      const deepest = reliefFrom !== undefined ? RELIEF.deepest : (picture?.deepest ?? MIN_LEVEL)
      // what the screen itself spans, in degrees, with a little to spare for the globe's curve
      const seenLng = Math.min(2 * lngHalf, ((w / scale) * 180) / Math.PI / Math.max(0.3, Math.cos((view.lat * Math.PI) / 180)) * 1.15)
      const seenLat = Math.min(2 * latHalf, ((h / scale) * 180) / Math.PI * 1.15)
      let level = Math.min(deepest, Math.max(MIN_LEVEL, Math.ceil(Math.log2((perDegree * SPAN) / TILE) - 0.35)))
      // one level less sharp rather than a sharp patch smaller than the screen
      while (level > MIN_LEVEL && Math.max(seenLng, seenLat) / (SPAN / 2 ** level) + 1 > MAX_SIDE) level--
      const span = SPAN / 2 ** level
      const rows = Math.round(180 / span)
      let x0 = Math.floor((view.lng - lngHalf + 180) / span)
      let x1 = Math.floor((view.lng + lngHalf + 180) / span)
      let y0 = Math.max(0, Math.floor((90 - north) / span))
      let y1 = Math.min(rows - 1, Math.floor((90 - south) / span))
      // More than fits: keep the full detail and cut the area down round the
      // middle of the screen (the edges keep the bundled picture), rather than
      // fetching everything blurrier.
      const cx = Math.floor((view.lng + 180) / span)
      const cy = Math.min(rows - 1, Math.max(0, Math.floor((90 - view.lat) / span)))
      if (x1 - x0 + 1 > MAX_SIDE) {
        x0 = Math.max(x0, cx - Math.floor((MAX_SIDE - 1) / 2))
        x1 = x0 + MAX_SIDE - 1
      }
      if (y1 - y0 + 1 > MAX_SIDE) {
        y0 = Math.min(Math.max(y0, cy - Math.floor((MAX_SIDE - 1) / 2)), rows - MAX_SIDE)
        y1 = y0 + MAX_SIDE - 1
      }

      // already on screen: nothing to do
      if (covers(shown, { style, level, x0, x1, y0, y1 })) {
        wanted = ''
        return
      }
      // a tile of margin all round where it fits, so the next small move is covered too
      if (x1 - x0 + 3 <= MAX_SIDE) {
        x0--
        x1++
      }
      if (y1 - y0 + 3 <= MAX_SIDE) {
        y0 = Math.max(0, y0 - 1)
        y1 = Math.min(rows - 1, y1 + 1)
      }

      const key = [style, level, x0, x1, y0, y1].join('|')
      if (key === wanted) return
      wanted = key
      const previous = shown?.style === style ? shown.detail : null

      /**
       * Stitches the tiles of one source over the wanted area. A source that
       * does not reach this level is read at its deepest and enlarged.
       */
      const stitch = (source: Source, which: 'image' | 'relief', progress: () => void) => {
        const up = 2 ** Math.max(0, level - source.deepest) // how many wanted tiles one source tile spans
        const at = level - Math.log2(up)
        const columns = Math.round(360 / (SPAN / 2 ** at))
        const sheet = document.createElement('canvas')
        sheet.width = (x1 - x0 + 1) * TILE
        sheet.height = (y1 - y0 + 1) * TILE
        const ctx = sheet.getContext('2d')!
        // start from what is on screen now, so tiles still on their way don't show up blurry
        const old = previous?.[which]
        if (old && previous) {
          const k = TILE / span // pixels per degree on the new sheet
          let dx = (((previous.west - (x0 * span - 180)) % 360) + 360) % 360
          if (dx > 180) dx -= 360
          ctx.drawImage(old, dx * k, (90 - y0 * span - previous.north) * k, previous.width * k, previous.height * k)
        }
        const jobs: Promise<void>[] = []
        for (let y = Math.floor(y0 / up); y <= Math.floor(y1 / up); y++) {
          for (let x = Math.floor(x0 / up); x <= Math.floor(x1 / up); x++) {
            const column = ((x % columns) + columns) % columns // the globe wraps round
            jobs.push(
              tile(`${SERVICE}/${source.path}/${at}/${y}/${column}.jpeg`).then((image) => {
                // a tile that failed keeps what was there, or stays clear and the bundled image shows
                if (!image) return
                ctx.drawImage(image, (x * up - x0) * TILE, (y * up - y0) * TILE, TILE * up, TILE * up)
                progress()
              }),
            )
          }
        }
        return { sheet, done: Promise.all(jobs) }
      }

      const west = x0 * span - 180
      const frame = {
        west: ((((west + 180) % 360) + 360) % 360) - 180,
        north: 90 - y0 * span,
        width: (x1 - x0 + 1) * span,
        height: (y1 - y0 + 1) * span,
      }
      const range = { style, level, x0, x1, y0, y1 }
      const wantRelief = reliefFrom !== undefined && level >= reliefFrom
      let early = 0
      const publish = () => {
        clearTimeout(early)
        early = 0
        if (wanted !== key) return // the view moved on while these were loading
        const detail: Detail = { style, image: image?.sheet ?? null, relief: relief?.sheet ?? null, ...frame }
        shown = { ...range, detail }
        onChange(detail)
      }
      // Show what has arrived a moment after the first tiles come in, then
      // everything once it is all here. Uploading a big picture costs a frame
      // or two, so not after every single tile.
      const progress = () => {
        if (!early) early = window.setTimeout(publish, 600)
      }
      const image = picture ? stitch(picture, 'image', progress) : null
      const relief = wantRelief ? stitch(RELIEF, 'relief', progress) : null
      void Promise.all([image?.done, relief?.done]).then(publish)
    },
  }
}
