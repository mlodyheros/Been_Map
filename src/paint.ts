import { geoDistance, geoGraticule10, geoNaturalEarth1, geoOrthographic, geoPath } from 'd3-geo'
import type { Layer, Shape } from './geo'
import { BY_A2, PEOPLE_COLOR, STATUSES, type MapMode, type Status, type Statuses } from './model'

export interface View {
  /** Longitude / latitude at the centre of the map. */
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

const SEA_TOP = '#DCE3F6'
const SEA_BOTTOM = '#C2CDEF'
const LAND = '#FFFFFF'
const BORDER = '#AEB8D8'
const INK = '#151A33'
const RAD = Math.PI / 180

// Countries too small to see as a filled shape get a dot when marked.
export const DOT_BELOW_KM2 = 2500

/** Projection scale at zoom 1: the globe's radius, or the flat map fitted to the stage. */
export const baseScale = (mode: MapMode, w: number, h: number) =>
  mode === 'globe' ? (Math.min(w, h) / 2) * 0.86 : Math.min(w / 5.7, h / 3.1)

// The flat map at scale 1 around the origin. It never rotates, so every shape
// can be projected once and then only moved and scaled.
const flatUnit = geoNaturalEarth1().scale(1).translate([0, 0]).precision(0)
const flatUnitSmooth = geoNaturalEarth1().scale(1).translate([0, 0]).precision(0.002)

/**
 * A d3 projection matching what the fast painters below draw. Used for the
 * few things that need exact maths rather than speed: markers and hit-testing.
 */
export function makeProjection(mode: MapMode, w: number, h: number, view: View) {
  const scale = baseScale(mode, w, h) * view.zoom
  if (mode === 'flat') {
    const [ux, uy] = flatUnit([view.lng, view.lat])!
    return geoNaturalEarth1()
      .scale(scale)
      .translate([w / 2 - ux * scale, h / 2 - uy * scale])
      .precision(0)
  }
  return geoOrthographic()
    .translate([w / 2, h / 2])
    .scale(scale)
    .rotate([-view.lng, -view.lat])
    .clipAngle(90)
    .precision(0)
}

// ---------- fast shape tracing ----------

const flatPaths = new WeakMap<Shape, Path2D>()
function flatPath(shape: Shape) {
  let path = flatPaths.get(shape)
  if (!path) {
    path = new Path2D()
    geoPath(flatUnit, path as unknown as CanvasRenderingContext2D)(shape.feature)
    flatPaths.set(shape, path)
  }
  return path
}

// Each ring as points on the unit sphere (x, y, z triples), ready to be rotated.
const sphereRings = new WeakMap<Shape, Float64Array[]>()
function ringsOf(shape: Shape) {
  let rings = sphereRings.get(shape)
  if (!rings) {
    const g = shape.feature.geometry
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    rings = []
    for (const polygon of polygons) {
      for (const ring of polygon) {
        const out = new Float64Array(ring.length * 3)
        ring.forEach(([lng, lat], i) => {
          const cos = Math.cos(lat * RAD)
          out[i * 3] = cos * Math.cos(lng * RAD)
          out[i * 3 + 1] = cos * Math.sin(lng * RAD)
          out[i * 3 + 2] = Math.sin(lat * RAD)
        })
        rings.push(out)
      }
    }
    sphereRings.set(shape, rings)
  }
  return rings
}

/** Returns a function that turns shapes into one screen-space path for this view. */
function makeTracer(mode: MapMode, w: number, h: number, view: View): (shapes: Iterable<Shape>) => Path2D {
  const scale = baseScale(mode, w, h) * view.zoom
  const cx = w / 2
  const cy = h / 2

  if (mode === 'flat') {
    const [ux, uy] = flatUnit([view.lng, view.lat])!
    const matrix = new DOMMatrix([scale, 0, 0, scale, cx - ux * scale, cy - uy * scale])
    return (shapes) => {
      const path = new Path2D()
      for (const s of shapes) path.addPath(flatPath(s), matrix)
      return path
    }
  }

  // Orthographic projection by hand: rotate so the view centre faces the
  // viewer, then drop the depth axis. Points on the far side are pushed out to
  // the limb, which closes partly hidden countries along the globe's edge.
  const sinL = Math.sin(view.lng * RAD)
  const cosL = Math.cos(view.lng * RAD)
  const sinP = Math.sin(view.lat * RAD)
  const cosP = Math.cos(view.lat * RAD)
  return (shapes) => {
    const path = new Path2D()
    for (const s of shapes) {
      for (const ring of ringsOf(s)) {
        let anyVisible = false
        for (let i = 0; i < ring.length; i += 3) {
          const forward = ring[i] * cosL + ring[i + 1] * sinL
          if (forward * cosP + ring[i + 2] * sinP > 0) {
            anyVisible = true
            break
          }
        }
        if (!anyVisible) continue
        let lastX = 0
        let lastY = 0
        for (let i = 0; i < ring.length; i += 3) {
          const forward = ring[i] * cosL + ring[i + 1] * sinL
          let right = ring[i + 1] * cosL - ring[i] * sinL
          let up = ring[i + 2] * cosP - forward * sinP
          if (forward * cosP + ring[i + 2] * sinP < 0) {
            const length = Math.hypot(right, up) || 1
            right /= length
            up /= length
          }
          const x = cx + right * scale
          const y = cy - up * scale
          if (i === 0) path.moveTo(x, y)
          // canvas calls, not the maths, are what costs time: skip points that
          // land within a fraction of a pixel of the last one drawn
          else if (Math.abs(x - lastX) + Math.abs(y - lastY) < 0.75) continue
          else path.lineTo(x, y)
          lastX = x
          lastY = y
        }
        path.closePath()
      }
    }
    return path
  }
}

/** Shapes that can appear on screen for this view; the rest are skipped before any projection work. */
function visibleShapes(layer: Layer, mode: MapMode, w: number, h: number, view: View): Shape[] {
  if (mode === 'flat') return layer.shapes // already projected; drawing them is cheap
  const scale = baseScale(mode, w, h) * view.zoom
  const reach = Math.hypot(w, h) / 2
  const centre: [number, number] = [view.lng, view.lat]
  // angle from the view centre to the edge of what the viewport shows of the sphere
  const cap = reach >= scale ? Math.PI / 2 : Math.asin(reach / scale)
  return layer.shapes.filter((s) => geoDistance(centre, s.centre) <= cap + s.radius)
}

// ---------- static decoration ----------

const graticule = geoGraticule10()
let flatDecor: { outline: Path2D; graticule: Path2D } | null = null
function flatDecoration() {
  if (!flatDecor) {
    const outline = new Path2D()
    geoPath(flatUnitSmooth, outline as unknown as CanvasRenderingContext2D)({ type: 'Sphere' })
    const lines = new Path2D()
    geoPath(flatUnitSmooth, lines as unknown as CanvasRenderingContext2D)(graticule)
    flatDecor = { outline, graticule: lines }
  }
  return flatDecor
}

/** The sea's outline and the graticule, as screen-space paths. */
function decoration(mode: MapMode, w: number, h: number, view: View) {
  const scale = baseScale(mode, w, h) * view.zoom
  if (mode === 'flat') {
    const [ux, uy] = flatUnit([view.lng, view.lat])!
    const matrix = new DOMMatrix([scale, 0, 0, scale, w / 2 - ux * scale, h / 2 - uy * scale])
    const outline = new Path2D()
    outline.addPath(flatDecoration().outline, matrix)
    const lines = new Path2D()
    lines.addPath(flatDecoration().graticule, matrix)
    return { outline, graticule: lines }
  }
  const outline = new Path2D()
  outline.arc(w / 2, h / 2, scale, 0, Math.PI * 2)
  const lines = new Path2D()
  geoPath(makeProjection(mode, w, h, view), lines as unknown as CanvasRenderingContext2D)(graticule)
  return { outline, graticule: lines }
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

/** Light from the upper left and a darker limb, so the globe reads as a sphere. */
function shadeGlobe(ctx: CanvasRenderingContext2D, w: number, h: number, scale: number, region: Path2D) {
  const cx = w / 2
  const cy = h / 2
  const light = ctx.createRadialGradient(cx - scale * 0.32, cy - scale * 0.38, scale * 0.1, cx, cy, scale * 1.02)
  light.addColorStop(0, 'rgba(255, 255, 255, 0.2)')
  light.addColorStop(0.55, 'rgba(255, 255, 255, 0)')
  light.addColorStop(0.86, 'rgba(40, 52, 130, 0.07)')
  light.addColorStop(1, 'rgba(40, 52, 130, 0.22)')
  ctx.fillStyle = light
  ctx.fill(region, 'evenodd')
}

function fillShapes(ctx: CanvasRenderingContext2D, path: Path2D, status: Status | undefined) {
  ctx.fillStyle = status ? STATUSES.find((s) => s.id === status)!.color : LAND
  ctx.fill(path, 'evenodd')
  if (status === 'wish') {
    ctx.fillStyle = wishHatch(ctx) ?? LAND
    ctx.fill(path, 'evenodd')
  }
  ctx.strokeStyle = status ? 'rgba(255, 255, 255, 0.7)' : BORDER
  ctx.lineWidth = status ? 0.9 : 0.6
  ctx.lineJoin = 'round'
  ctx.stroke(path)
}

// ---------- painters ----------

/** Everything that only changes with the view or the markings. */
export function paintMap(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene) {
  const { mode, view, layer, statuses } = scene
  const scale = baseScale(mode, w, h) * view.zoom
  const span = mode === 'globe' ? scale : scale * 1.4
  const decor = decoration(mode, w, h, view)

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
  ctx.fill(decor.outline)

  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 1
  ctx.stroke(decor.graticule)

  if (layer) {
    const trace = makeTracer(mode, w, h, view)
    const groups: Record<Status | 'none', Shape[]> = { none: [], visited: [], lived: [], transit: [], wish: [] }
    for (const s of visibleShapes(layer, mode, w, h, view)) groups[(s.a2 && statuses[s.a2]) || 'none'].push(s)
    for (const id of ['none', 'visited', 'lived', 'transit', 'wish'] as const) {
      if (groups[id].length) fillShapes(ctx, trace(groups[id]), id === 'none' ? undefined : id)
    }
  }

  if (mode === 'globe') shadeGlobe(ctx, w, h, scale, decor.outline)
  paintMarkers(ctx, w, h, scene, decor.outline)
}

/** Dots, "know people" rings and the rim: cheap, and always on top of the fills. */
function paintMarkers(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene, outline: Path2D) {
  const { mode, view, statuses, people } = scene
  const projection = makeProjection(mode, w, h, view)
  const centre: [number, number] = [view.lng, view.lat]
  const visible = (lng: number, lat: number) =>
    mode === 'flat' || geoDistance([lng, lat], centre) < Math.PI / 2 - 0.02

  // dots for marked micro-states and islands
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
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 2
  ctx.stroke(outline)
}

/**
 * Repaints just the given countries on top of an already painted frame, so a
 * tap changes one country without redrawing the world.
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
  const scale = baseScale(mode, w, h) * view.zoom
  const trace = makeTracer(mode, w, h, view)
  for (const a2 of countries) {
    const path = trace(layer.shapes.filter((s) => s.a2 === a2))
    fillShapes(ctx, path, statuses[a2])
    // the fresh fill covered the globe's shading; put it back inside this country only
    if (mode === 'globe') shadeGlobe(ctx, w, h, scale, path)
  }
  paintMarkers(ctx, w, h, scene, decoration(mode, w, h, view).outline)
}

/** Hover highlight and click rings, drawn over a cached paintMap frame. */
export function paintOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene, overlay: Overlay) {
  const { mode, view, layer } = scene
  const { hover, pulses } = overlay

  if (hover && layer) {
    const path = makeTracer(mode, w, h, view)(layer.shapes.filter((s) => s.a2 === hover))
    ctx.fillStyle = 'rgba(21, 26, 51, 0.14)'
    ctx.fill(path, 'evenodd')
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.4
    ctx.lineJoin = 'round'
    ctx.stroke(path)
  }

  if (!pulses.length) return
  const projection = makeProjection(mode, w, h, view)
  const centre: [number, number] = [view.lng, view.lat]
  for (const pulse of pulses) {
    if (mode === 'globe' && geoDistance([pulse.lng, pulse.lat], centre) > Math.PI / 2 - 0.02) continue
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
