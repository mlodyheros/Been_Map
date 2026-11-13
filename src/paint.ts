import { geoDistance, geoNaturalEarth1, geoOrthographic, geoPath } from 'd3-geo'
import type { Layer, Shape } from './geo'
import { BY_A2, PEOPLE_COLOR, STATUSES, type MapMode, type MapStyle, type Status, type Statuses } from './model'

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
  style: MapStyle
  view: View
  layer: Layer | null
  statuses: Statuses
  people: ReadonlySet<string>
}

export interface Overlay {
  hover: string | null
  pulses: Pulse[]
}

const SEA_TOP = '#FFFFFF'
const SEA_BOTTOM = '#E7EAF4'
const LAND = '#D5D9E8'
const BORDER = '#FFFFFF'
const INK = '#141833'
const RAD = Math.PI / 180

// Countries too small to see as a filled shape get a dot when marked.
export const DOT_BELOW_KM2 = 2500

/** Projection scale at zoom 1: the globe's radius, or the flat map fitted to the stage. */
export const baseScale = (mode: MapMode, w: number, h: number) => {
  // leave room for the controls that float above and below the map
  const free = Math.max(h - 120, h * 0.6)
  return mode === 'globe' ? (Math.min(w, free) / 2) * 0.92 : Math.min(w / 5.7, free / 2.9)
}

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

let flatOutline: Path2D | null = null

/** The edge of the map (the globe's disc or the flat map's outline) as a screen-space path. */
function outlineOf(mode: MapMode, w: number, h: number, view: View) {
  const scale = baseScale(mode, w, h) * view.zoom
  const outline = new Path2D()
  if (mode === 'flat') {
    if (!flatOutline) {
      flatOutline = new Path2D()
      geoPath(flatUnitSmooth, flatOutline as unknown as CanvasRenderingContext2D)({ type: 'Sphere' })
    }
    const [ux, uy] = flatUnit([view.lng, view.lat])!
    outline.addPath(flatOutline, new DOMMatrix([scale, 0, 0, scale, w / 2 - ux * scale, h / 2 - uy * scale]))
  } else outline.arc(w / 2, h / 2, scale, 0, Math.PI * 2)
  return outline
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

/** Soft light from the upper left and a slightly darker limb, so the plain globe reads as a sphere. */
function shadeGlobe(ctx: CanvasRenderingContext2D, w: number, h: number, scale: number, region: Path2D) {
  const cx = w / 2
  const cy = h / 2
  const light = ctx.createRadialGradient(cx - scale * 0.32, cy - scale * 0.38, scale * 0.1, cx, cy, scale * 1.02)
  light.addColorStop(0, 'rgba(255, 255, 255, 0.18)')
  light.addColorStop(0.55, 'rgba(255, 255, 255, 0)')
  light.addColorStop(0.86, 'rgba(60, 70, 120, 0.05)')
  light.addColorStop(1, 'rgba(60, 70, 120, 0.2)')
  ctx.fillStyle = light
  ctx.fill(region, 'evenodd')
}

function fillShapes(ctx: CanvasRenderingContext2D, path: Path2D, status: Status | undefined, style: MapStyle) {
  const photo = style !== 'plain'
  if (status) {
    // over a photo the marking is a tint, so the terrain and city lights stay visible
    ctx.globalAlpha = photo ? 0.62 : 1
    ctx.fillStyle = STATUSES.find((s) => s.id === status)!.color
    ctx.fill(path, 'evenodd')
    if (status === 'wish') {
      ctx.fillStyle = wishHatch(ctx) ?? LAND
      ctx.fill(path, 'evenodd')
    }
    ctx.globalAlpha = 1
  } else if (!photo) {
    ctx.fillStyle = LAND
    ctx.fill(path, 'evenodd')
  }
  ctx.strokeStyle = status
    ? 'rgba(255, 255, 255, 0.9)'
    : style === 'night'
      ? 'rgba(170, 195, 255, 0.28)'
      : photo
        ? 'rgba(255, 255, 255, 0.45)'
        : BORDER
  ctx.lineWidth = status ? 1 : photo ? 0.6 : 0.8
  ctx.lineJoin = 'round'
  ctx.stroke(path)
}

// ---------- painters ----------

/**
 * Everything that only changes with the view or the markings. With a photo
 * style the sea and unmarked land are left transparent: the backdrop layer
 * underneath shows through.
 */
export function paintMap(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene) {
  const { mode, style, view, layer, statuses } = scene
  const scale = baseScale(mode, w, h) * view.zoom
  const span = mode === 'globe' ? scale : scale * 1.4
  const outline = outlineOf(mode, w, h, view)

  ctx.clearRect(0, 0, w, h)

  if (mode === 'globe') {
    // soft halo as a gradient: canvas shadowBlur is far too slow to run every frame
    const cx = w / 2
    const cy = h / 2 + (style === 'plain' ? scale * 0.04 : 0)
    const tint = style === 'plain' ? '70, 80, 130' : style === 'night' ? '70, 130, 255' : '90, 150, 255'
    const glow = ctx.createRadialGradient(cx, cy, scale * 0.94, cx, cy, scale * 1.13)
    glow.addColorStop(0, `rgba(${tint}, ${style === 'plain' ? 0.22 : 0.4})`)
    glow.addColorStop(1, `rgba(${tint}, 0)`)
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, scale * 1.13, 0, Math.PI * 2)
    ctx.arc(w / 2, h / 2, scale, 0, Math.PI * 2, true)
    ctx.fill('evenodd')
  }

  if (style === 'plain') {
    const sea = ctx.createLinearGradient(0, h / 2 - span, 0, h / 2 + span)
    sea.addColorStop(0, SEA_TOP)
    sea.addColorStop(1, SEA_BOTTOM)
    ctx.fillStyle = sea
    ctx.fill(outline)
  }

  if (layer) {
    const trace = makeTracer(mode, w, h, view)
    const groups: Record<Status | 'none', Shape[]> = { none: [], visited: [], lived: [], transit: [], wish: [] }
    for (const s of visibleShapes(layer, mode, w, h, view)) groups[(s.a2 && statuses[s.a2]) || 'none'].push(s)
    for (const id of ['none', 'visited', 'lived', 'transit', 'wish'] as const) {
      if (groups[id].length) fillShapes(ctx, trace(groups[id]), id === 'none' ? undefined : id, style)
    }
  }

  if (mode === 'globe' && style === 'plain') shadeGlobe(ctx, w, h, scale, outline)
  paintMarkers(ctx, w, h, scene, outline)
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
  ctx.strokeStyle = scene.style === 'plain' ? 'rgba(150, 158, 190, 0.55)' : 'rgba(190, 215, 255, 0.35)'
  ctx.lineWidth = 1
  ctx.stroke(outline)
}

/** Hover highlight and click rings, drawn over a cached paintMap frame. */
export function paintOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene, overlay: Overlay) {
  const { mode, view, layer } = scene
  const { hover, pulses } = overlay

  if (hover && layer) {
    const path = makeTracer(mode, w, h, view)(layer.shapes.filter((s) => s.a2 === hover))
    const photo = scene.style !== 'plain'
    ctx.fillStyle = photo ? 'rgba(255, 255, 255, 0.2)' : 'rgba(20, 24, 51, 0.14)'
    ctx.fill(path, 'evenodd')
    ctx.strokeStyle = photo ? '#fff' : INK
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
