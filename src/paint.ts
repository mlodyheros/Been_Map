import { geoDistance, geoGraticule10, geoNaturalEarth1, geoOrthographic, geoPath } from 'd3-geo'
import type { Layer } from './geo'
import { BY_A2, PEOPLE_COLOR, STATUSES, type MapMode, type Status, type Statuses } from './model'

export interface View {
  /** Longitude / latitude at the centre of the globe. */
  lng: number
  lat: number
  zoom: number
}

export interface Pulse {
  lng: number
  lat: number
  color: string
  /** 0 → 1 */
  t: number
}

const SEA_TOP = '#DCE3F6'
const SEA_BOTTOM = '#C2CDEF'
const LAND = '#FFFFFF'
const BORDER = '#AEB8D8'
const INK = '#151A33'

// Countries too small to see as a filled shape get a dot when marked.
export const DOT_BELOW_KM2 = 2500

const graticule = geoGraticule10()

/** Projection scale at zoom 1: the globe's radius, or the flat map fitted to the stage. */
export const baseScale = (mode: MapMode, w: number, h: number) =>
  mode === 'globe' ? (Math.min(w, h) / 2) * 0.86 : Math.min(w / 5.7, h / 3.1)

/**
 * `smooth` turns on d3's adaptive resampling. The country data is dense enough
 * not to need it (and it roughly doubles the cost of a frame); only the flat
 * map's outline does.
 */
export function makeProjection(mode: MapMode, w: number, h: number, view: View, smooth = false) {
  const scale = baseScale(mode, w, h) * view.zoom
  const projection =
    mode === 'flat'
      ? geoNaturalEarth1().rotate([-view.lng, 0]).center([0, view.lat])
      : geoOrthographic().rotate([-view.lng, -view.lat]).clipAngle(90)
  return projection
    .translate([w / 2, h / 2])
    .scale(scale)
    .precision(smooth ? 0.7 : 0)
}

export interface Scene {
  mode: MapMode
  view: View
  layer: Layer | null
  statuses: Statuses
  people: ReadonlySet<string>
}

export interface Overlay {
  hover: string | null
  pulses: Pulse[]
}

let hatch: CanvasPattern | null = null
function wishHatch(ctx: CanvasRenderingContext2D) {
  if (hatch) return hatch
  const tile = document.createElement('canvas')
  tile.width = tile.height = 8
  const t = tile.getContext('2d')!
  t.strokeStyle = 'rgba(255,255,255,0.6)'
  t.lineWidth = 2
  t.beginPath()
  for (const o of [-8, 0, 8]) {
    t.moveTo(o, 8)
    t.lineTo(o + 8, 0)
  }
  t.stroke()
  hatch = ctx.createPattern(tile, 'repeat')
  return hatch
}

const sphere = { type: 'Sphere' } as const

/** Everything that only changes with the view or the markings. */
export function paintMap(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene) {
  const { mode, view, layer, statuses } = scene
  const projection = makeProjection(mode, w, h, view)
  const path = geoPath(projection, ctx)
  const outline = geoPath(makeProjection(mode, w, h, view, true), ctx)
  const scale = baseScale(mode, w, h) * view.zoom
  const span = mode === 'globe' ? scale : scale * 1.4

  ctx.clearRect(0, 0, w, h)

  if (mode === 'globe') {
    // ground shadow as a gradient: canvas shadowBlur is far too slow to run every frame
    const cx = w / 2
    const cy = h / 2 + scale * 0.05
    const glow = ctx.createRadialGradient(cx, cy, scale * 0.92, cx, cy, scale * 1.14)
    glow.addColorStop(0, 'rgba(47, 69, 224, 0.2)')
    glow.addColorStop(1, 'rgba(47, 69, 224, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, scale * 1.14, 0, Math.PI * 2)
    ctx.fill()
  }

  const sea = ctx.createLinearGradient(0, h / 2 - span, 0, h / 2 + span)
  sea.addColorStop(0, SEA_TOP)
  sea.addColorStop(1, SEA_BOTTOM)
  ctx.fillStyle = sea
  ctx.beginPath()
  outline(sphere)
  ctx.fill()

  ctx.beginPath()
  path(graticule)
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 1
  ctx.stroke()

  if (layer) {
    const groups: Record<Status | 'none', typeof layer.shapes> = {
      none: [],
      visited: [],
      lived: [],
      transit: [],
      wish: [],
    }
    for (const s of layer.shapes) groups[statuses[s.a2] ?? 'none'].push(s)

    ctx.beginPath()
    for (const f of layer.inert) path(f)
    for (const s of groups.none) path(s.feature)
    ctx.fillStyle = LAND
    ctx.fill()

    for (const { id, color } of STATUSES) {
      if (!groups[id].length) continue
      ctx.beginPath()
      for (const s of groups[id]) path(s.feature)
      ctx.fillStyle = color
      ctx.fill()
      if (id === 'wish') {
        ctx.fillStyle = wishHatch(ctx) ?? color
        ctx.fill()
      }
    }

    ctx.beginPath()
    path(layer.borders)
    ctx.strokeStyle = BORDER
    ctx.lineWidth = 0.6
    ctx.lineJoin = 'round'
    ctx.stroke()
  }

  paintMarkers(ctx, w, h, scene)
}

/** Dots, "know people" rings and the rim: cheap, and always on top of the fills. */
function paintMarkers(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene) {
  const { mode, view, statuses, people } = scene
  const projection = makeProjection(mode, w, h, view)
  const outline = geoPath(makeProjection(mode, w, h, view, true), ctx)

  // dots for marked micro-states and islands
  const centre: [number, number] = [view.lng, view.lat]
  const visible = (lng: number, lat: number) =>
    mode === 'flat' || geoDistance([lng, lat], centre) < Math.PI / 2 - 0.02
  for (const [a2, status] of Object.entries(statuses)) {
    const c = BY_A2.get(a2)
    if (!c || c.area >= DOT_BELOW_KM2 || !visible(c.lng, c.lat)) continue
    const p = projection([c.lng, c.lat])
    if (!p) continue
    ctx.beginPath()
    ctx.arc(p[0], p[1], 4.5, 0, Math.PI * 2)
    ctx.fillStyle = STATUSES.find((s) => s.id === status)!.color
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  // "know people from" rings sit on top of whatever the country is filled with
  for (const a2 of people) {
    const c = BY_A2.get(a2)
    if (!c || !visible(c.lng, c.lat)) continue
    const p = projection([c.lng, c.lat])
    if (!p) continue
    ctx.beginPath()
    ctx.arc(p[0], p[1], 7.5, 0, Math.PI * 2)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 5.5
    ctx.stroke()
    ctx.strokeStyle = PEOPLE_COLOR
    ctx.lineWidth = 3
    ctx.stroke()
  }

  // rim
  ctx.beginPath()
  outline(sphere)
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 2
  ctx.stroke()
}

/**
 * Repaints just the given countries on top of an already painted frame. A full
 * frame at 50m detail takes tens of milliseconds, which is too slow for the
 * map to feel instant when a single country is tapped.
 */
export function patchCountries(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: Scene,
  countries: ReadonlySet<string>,
) {
  const { mode, view, layer, statuses } = scene
  if (!layer) return
  const path = geoPath(makeProjection(mode, w, h, view), ctx)
  for (const s of layer.shapes) {
    if (!countries.has(s.a2)) continue
    const status = statuses[s.a2]
    ctx.beginPath()
    path(s.feature)
    ctx.fillStyle = status ? STATUSES.find((x) => x.id === status)!.color : LAND
    ctx.fill()
    if (status === 'wish') {
      ctx.fillStyle = wishHatch(ctx) ?? LAND
      ctx.fill()
    }
    ctx.strokeStyle = BORDER
    ctx.lineWidth = 0.6
    ctx.lineJoin = 'round'
    ctx.stroke()
  }
  paintMarkers(ctx, w, h, scene)
}

/** Hover highlight and click rings, drawn over a cached paintMap frame. */
export function paintOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene, overlay: Overlay) {
  const { mode, view, layer } = scene
  const { hover, pulses } = overlay
  const projection = makeProjection(mode, w, h, view)
  const path = geoPath(projection, ctx)
  const centre: [number, number] = [view.lng, view.lat]
  const visible = (lng: number, lat: number) =>
    mode === 'flat' || geoDistance([lng, lat], centre) < Math.PI / 2 - 0.02

  if (hover && layer) {
    ctx.beginPath()
    for (const s of layer.shapes) if (s.a2 === hover) path(s.feature)
    ctx.fillStyle = 'rgba(21, 26, 51, 0.14)'
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.4
    ctx.lineJoin = 'round'
    ctx.stroke()
  }

  for (const pulse of pulses) {
    if (!visible(pulse.lng, pulse.lat)) continue
    const p = projection([pulse.lng, pulse.lat])
    if (!p) continue
    const ease = 1 - Math.pow(1 - pulse.t, 3)
    ctx.beginPath()
    ctx.arc(p[0], p[1], 6 + ease * 46, 0, Math.PI * 2)
    ctx.strokeStyle = pulse.color
    ctx.globalAlpha = 1 - pulse.t
    ctx.lineWidth = 3 * (1 - pulse.t) + 0.5
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}
