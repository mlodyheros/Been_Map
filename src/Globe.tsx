import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { geoNaturalEarth1Raw } from 'd3-geo'
import { createBackdrop, type Backdrop } from './backdrop'
import { createDetailLoader } from './detail'
import type { Pin } from './extras'
import { countryAt, levelFor, loadWorld, type Shape, type World } from './geo'
import { REGION_COUNTRIES, loadRegions, nearestRegion, regionAt, regionName, type Regions } from './regions'
import { countryName, STRINGS, type Lang } from './i18n'
import { BY_A2, flag, type MapMode, type MapStyle, type Statuses } from './model'
import {
  baseScale,
  makeProjection,
  paintMap,
  paintOverlay,
  type Pulse,
  type Scene,
  type View,
} from './paint'

/** What a tap on the map landed on. */
export interface Hit {
  a2: string | null
  /** Set only while regions are being marked. */
  region: string | null
  /** Id of the place marker under the pointer, if any. */
  pin: string | null
  lng: number
  lat: number
}

export interface GlobeHandle {
  flyTo(a2: string): void
  flyToPoint(lng: number, lat: number, zoom: number): void
  zoomBy(factor: number): void
  /** Renders the map as it currently looks onto a fresh square canvas. */
  snapshot(size: number): HTMLCanvasElement
}

interface Props {
  statuses: Statuses
  people: ReadonlySet<string>
  pins: readonly Pin[]
  regions: Statuses
  /** Taps mark states and provinces where a country has them. */
  regionLevel: boolean
  /** Your own markings while someone else's map is compared with them. */
  compare: Statuses | null
  mode: MapMode
  style: MapStyle
  lang: Lang
  /** Applies the active marking; returns its colour, or null when nothing was added. */
  onPick(hit: Hit): string | null
}

const MAX_ZOOM = 24
const START: View = { lng: 15, lat: 38, zoom: 1 }
const FLAT_START: View = { lng: 0, lat: 0, zoom: 1 }
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** The globe may shrink a little; the flat map never gets smaller than the whole world fitted to the screen. */
const minZoom = (mode: MapMode) => (mode === 'flat' ? 1 : 0.8)

const RAD = Math.PI / 180
// half the width and height of the flat map, in the projection's own units
const FLAT_HALF_W = geoNaturalEarth1Raw(Math.PI, 0)[0]
const FLAT_HALF_H = geoNaturalEarth1Raw(0, Math.PI / 2)[1]

/** Where the flat map's view centre sits, in the projection's units (y up). */
const flatCentre = (view: View) => geoNaturalEarth1Raw(view.lng * RAD, view.lat * RAD)
function setFlatCentre(view: View, x: number, y: number) {
  const [lng, lat] = geoNaturalEarth1Raw.invert!(x, clamp(y, -FLAT_HALF_H, FLAT_HALF_H))
  view.lng = clamp(lng / RAD, -180, 180)
  view.lat = clamp(lat / RAD, -85, 85)
}

/**
 * Keeps the flat map on the screen: while all of it fits it stays centred, and
 * once zoomed in it can be moved only until its edge meets the screen's edge.
 */
function keepFlatInView(view: View, w: number, h: number) {
  const scale = baseScale('flat', w, h) * view.zoom
  const [x, y] = flatCentre(view)
  const reachX = Math.max(0, FLAT_HALF_W - w / (2 * scale))
  const reachY = Math.max(0, FLAT_HALF_H - h / (2 * scale))
  const cx = clamp(x, -reachX, reachX)
  const cy = clamp(y, -reachY, reachY)
  if (Math.abs(cx - x) > 1e-9 || Math.abs(cy - y) > 1e-9) setFlatCentre(view, cx, cy)
}
/** The globe spins freely; the flat map stops at its edges. */
const wrapLng = (lng: number, mode: MapMode) => (mode === 'flat' ? clamp(lng, -180, 180) : lng)
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const Globe = forwardRef<GlobeHandle, Props>(function Globe(
  { statuses, people, pins, regions, regionLevel, compare, mode, style, lang, onPick },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const photoRef = useRef<HTMLCanvasElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  // Everything the render loop reads lives in one mutable object so that
  // dragging never goes through React.
  const state = useRef({
    view: mode === 'flat' ? { ...FLAT_START } : { ...START },
    world: null as World | null,
    statuses,
    people,
    pins,
    regions,
    regionLevel,
    compare,
    regionData: null as Regions | null,
    mode,
    style,
    lang,
    onPick,
    backdrop: null as Backdrop | null,
    /** What the photo layer currently shows, so it is only redrawn when that changes. */
    backdropKey: '',
    size: { w: 0, h: 0 },
    hover: null as string | null,
    hoverRegion: null as string | null,
    /** Pointer position waiting for a hover lookup on the next frame. */
    probe: null as [number, number] | null,
    /** Bumped whenever the cached frame has to be repainted from scratch. */
    version: 0,
    painted: mode,
    cache: null as HTMLCanvasElement | null,
    cacheKey: '',
    pulses: [] as (Pulse & { start: number })[],
    velocity: { lng: 0, lat: 0 },
    fly: null as { from: View; to: View; start: number; ms: number } | null,
    moving: false,
    frame: 0,
    settle: 0,
    request: () => {},
  }).current

  state.statuses = statuses
  state.people = people
  state.pins = pins
  state.regions = regions
  state.regionLevel = regionLevel
  state.compare = compare
  state.mode = mode
  state.style = style
  state.lang = lang
  state.onPick = onPick

  useEffect(() => {
    const before = state.painted
    state.painted = mode
    // Any change repaints the whole map. Painting one country over the old
    // frame is cheaper but leaves traces of its previous outline behind.
    state.version++

    if (before !== mode) {
      // a flat map reads best centred near the equator, the globe a little north of it
      if (mode === 'flat') {
        // bring a globe that has been spun round back onto the map's -180…180 range
        const lng = ((((state.view.lng + 180) % 360) + 360) % 360) - 180
        state.view = state.view.zoom < 1.3 ? { ...FLAT_START } : { ...state.view, lng }
      } else if (state.view.zoom < 1.3) state.view = { lng: state.view.lng, lat: START.lat, zoom: 1 }
      state.velocity = { lng: 0, lat: 0 }
      state.fly = null
      const layers = wrapRef.current?.querySelector('.globe-layers')
      if (layers && !reducedMotion()) {
        layers.classList.remove('swap')
        void (layers as HTMLElement).offsetWidth // restart the animation
        layers.classList.add('swap')
      }
    }
    state.request()
  }, [statuses, people, pins, regions, regionLevel, compare, mode, style, state])

  // region shapes are fetched the first time they are needed
  const wantRegions = regionLevel || Object.keys(regions).length > 0
  useEffect(() => {
    if (!wantRegions || state.regionData) return
    let current = true
    loadRegions().then(
      (data) => {
        if (!current) return
        state.regionData = data
        state.version++
        state.request()
      },
      () => {},
    )
    return () => {
      current = false
    }
  }, [wantRegions, state])

  const sceneOf = (shown: MapStyle, layer: Scene['layer']): Scene => ({
    mode: state.mode,
    style: shown,
    view: state.view,
    layer,
    statuses: state.statuses,
    people: state.people,
    pins: state.pins,
    regions: state.regions,
    regionShapes: state.regionData?.shapes ?? null,
    regionBorders: state.regionLevel,
    compare: state.compare,
  })

  useImperativeHandle(ref, () => ({
    flyTo(a2) {
      const c = BY_A2.get(a2)
      if (!c) return
      // close enough for the country to fill a good part of the map
      const zoom = c.area < 5_000 ? 12 : c.area < 30_000 ? 7 : c.area < 150_000 ? 5 : c.area < 400_000 ? 3.8 : c.area < 2_500_000 ? 2.5 : 1.6
      const to = { lng: c.lng, lat: clamp(c.lat, -80, 80), zoom }
      state.velocity = { lng: 0, lat: 0 }
      if (reducedMotion()) state.view = to
      else state.fly = { from: { ...state.view }, to, start: performance.now(), ms: 900 }
      state.request()
    },
    flyToPoint(lng, lat, zoom) {
      const to = { lng, lat: clamp(lat, -80, 80), zoom: Math.max(zoom, state.view.zoom) }
      state.velocity = { lng: 0, lat: 0 }
      if (reducedMotion()) state.view = to
      else state.fly = { from: { ...state.view }, to, start: performance.now(), ms: 900 }
      state.request()
    },
    zoomBy(factor) {
      state.fly = null
      state.view.zoom = clamp(state.view.zoom * factor, minZoom(state.mode), MAX_ZOOM)
      state.request()
    },
    snapshot(size) {
      const out = document.createElement('canvas')
      out.width = out.height = size
      const ctx = out.getContext('2d')!
      const photo = photoRef.current
      if (state.backdrop && photo && state.style !== 'plain') {
        const scale = baseScale(state.mode, size, size) * state.view.zoom
        if (state.backdrop.draw(state.style, state.mode, size, size, scale, state.view)) ctx.drawImage(photo, 0, 0)
        // the layer on screen was resized for this; have the next frame restore it
        state.backdropKey = ''
        state.request()
      }
      const scratch = document.createElement('canvas')
      scratch.width = scratch.height = size
      paintMap(scratch.getContext('2d')!, size, size, sceneOf(state.style, state.world?.detail ?? null))
      ctx.drawImage(scratch, 0, 0)
      return out
    },
  }))

  useEffect(() => {
    const wrap = wrapRef.current!
    const canvas = canvasRef.current!
    const tip = tipRef.current!
    const ctx = canvas.getContext('2d')!
    let disposed = false
    const photo = photoRef.current!
    const makeBackdrop = () =>
      createBackdrop(photo, () => {
        state.backdropKey = ''
        state.request()
      })
    state.backdrop = makeBackdrop()
    // Phones (iOS Safari in particular) drop the graphics context when memory
    // runs short; without this the picture under the map would stay blank.
    const lost = (e: Event) => e.preventDefault()
    const restored = () => {
      state.backdrop = makeBackdrop()
      state.backdropKey = ''
      sharpen.reset()
      state.request()
    }
    photo.addEventListener('webglcontextlost', lost)
    photo.addEventListener('webglcontextrestored', restored)
    const sharpen = createDetailLoader((detail) => {
      if (disposed) return
      state.backdrop?.setDetail(detail)
      state.backdropKey = ''
      state.request()
    })

    const draw = (now: number) => {
      state.frame = 0
      const { view, size } = state
      if (size.w < 2 || size.h < 2) return
      let animating = false

      if (state.fly) {
        const { from, to, start, ms } = state.fly
        const t = clamp((now - start) / ms, 0, 1)
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
        // the globe turns the short way round; the flat map has no way round
        const dLng = state.mode === 'flat' ? to.lng - from.lng : ((((to.lng - from.lng + 180) % 360) + 360) % 360) - 180
        view.lng = from.lng + dLng * e
        view.lat = from.lat + (to.lat - from.lat) * e
        view.zoom = from.zoom + (to.zoom - from.zoom) * e
        if (t < 1) animating = true
        else state.fly = null
      } else if (
        // still moving by more than a fraction of a pixel a frame
        (Math.abs(state.velocity.lng) + Math.abs(state.velocity.lat)) * baseScale(state.mode, size.w, size.h) * view.zoom > 15
      ) {
        view.lng = wrapLng(view.lng + state.velocity.lng, state.mode)
        view.lat = clamp(view.lat + state.velocity.lat, -85, 85)
        state.velocity.lng *= 0.93
        state.velocity.lat *= 0.93
        animating = true
      }

      if (state.mode === 'flat') {
        if (!state.fly) view.zoom = Math.max(view.zoom, minZoom('flat'))
        keepFlatInView(view, size.w, size.h)
      }

      state.pulses = state.pulses.filter((p) => now - p.start < 600)
      for (const p of state.pulses) p.t = (now - p.start) / 600

      const moving = animating || state.moving
      // a hover lookup waits while the map moves rather than being dropped, so the
      // outline never stays behind on a country the pointer has already left
      if (state.probe && !moving) {
        probeHover()
        state.probe = null
      }

      const layer = state.world ? levelFor(state.world, view.zoom) : null
      const dpr = Math.min(devicePixelRatio || 1, 2)
      // without WebGL there is no photo layer, so the photo styles fall back to the plain one
      const style = state.backdrop ? state.style : 'plain'
      const scene = sceneOf(style, layer)

      // A still map is painted once and kept as a bitmap, so hovering and
      // click rings only cost a blit plus the overlay.
      const key = [state.mode, view.lng, view.lat, view.zoom, canvas.width, canvas.height, state.version, style].join('|')
      const backdropKey = [state.mode, view.lng, view.lat, view.zoom, canvas.width, canvas.height, style].join('|')
      if (state.backdrop && state.backdropKey !== backdropKey) {
        const scale = baseScale(state.mode, size.w, size.h) * view.zoom * dpr
        const ready = state.backdrop.draw(style, state.mode, canvas.width, canvas.height, scale, view)
        state.backdropKey = ready ? backdropKey : ''
      }

      // once the view rests, fetch sharper imagery for what is on screen
      if (!moving && state.backdrop) {
        sharpen.want(style, state.mode, view, size.w, size.h, baseScale(state.mode, size.w, size.h) * view.zoom, dpr)
      }

      if (!moving && layer && state.cache && state.cacheKey === key) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(state.cache, 0, 0)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      } else {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        paintMap(ctx, size.w, size.h, scene)
        if (!moving && layer) {
          const cache = (state.cache ??= document.createElement('canvas'))
          cache.width = canvas.width
          cache.height = canvas.height
          const store = cache.getContext('2d')!
          store.clearRect(0, 0, cache.width, cache.height)
          store.drawImage(canvas, 0, 0)
          state.cacheKey = key
        }
      }
      const region = state.hoverRegion && state.regionData?.byId.get(state.hoverRegion)
      const hover: Shape[] = region ? [region] : state.hover && layer ? layer.shapes.filter((s) => s.a2 === state.hover) : []
      if (hover.length || state.pulses.length) paintOverlay(ctx, size.w, size.h, scene, { hover, pulses: state.pulses })

      if (animating || state.pulses.length) state.request()
      else if (moving) {
        // interaction paused: repaint with full detail shortly after
        clearTimeout(state.settle)
        state.settle = window.setTimeout(() => {
          state.moving = false
          state.request()
        }, 140)
      }
    }

    state.request = () => {
      if (!state.frame && !disposed) state.frame = requestAnimationFrame(draw)
    }

    const resize = new ResizeObserver(() => {
      const { width: w, height: h } = wrap.getBoundingClientRect()
      const dpr = Math.min(devicePixelRatio || 1, 2)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      state.size = { w, h }
      state.request()
    })
    resize.observe(wrap)

    loadWorld().then((world) => {
      if (disposed) return
      state.world = world
      state.version++
      if (!reducedMotion()) {
        // opening move: the globe turns into place
        const to = { ...state.view }
        const from = state.mode === 'flat' ? { ...to, zoom: 1.12 } : { lng: to.lng - 70, lat: to.lat - 20, zoom: 0.9 }
        state.fly = { from, to, start: performance.now(), ms: 1400 }
      }
      state.request()
    })

    const local = (e: PointerEvent | WheelEvent) => {
      const box = canvas.getBoundingClientRect()
      // the map is briefly scaled while it swaps between globe and flat; taps must still land where they look
      const kx = box.width ? state.size.w / box.width : 1
      const ky = box.height ? state.size.h / box.height : 1
      return [(e.clientX - box.left) * kx, (e.clientY - box.top) * ky] as [number, number]
    }

    const pick = (x: number, y: number): Hit | null => {
      const { world, size, view } = state
      if (!world) return null
      const projection = makeProjection(state.mode, size.w, size.h, view)
      const at = projection.invert?.([x, y])
      // points outside the map outline don't survive a round trip
      const back = at && projection(at)
      if (!at || !back || !(Math.hypot(back[0] - x, back[1] - y) <= 1)) return null

      let pin: string | null = null
      let nearest = 12 // pixels: a marker is easier to hit than it is to see
      for (const p of state.pins) {
        const on = projection([p.lng, p.lat])
        const d = on ? Math.hypot(on[0] - x, on[1] - y) : Infinity
        if (d < nearest) {
          nearest = d
          pin = p.id
        }
      }
      const a2 = countryAt(world.detail, at[0], at[1], state.hover)
      let region: string | null = null
      if (state.regionLevel && !state.compare && state.regionData) {
        region = regionAt(state.regionData, at[0], at[1])?.id ?? null
        if (!region && a2 && REGION_COUNTRIES.has(a2)) {
          region = nearestRegion(state.regionData, a2, at[0], at[1], 15)?.id ?? null
        }
      }
      return { a2, region, pin, lng: at[0], lat: at[1] }
    }

    const showTip = (text: string | null, x: number, y: number) => {
      if (!text) {
        tip.hidden = true
        return
      }
      tip.hidden = false
      tip.textContent = text
      tip.style.transform = `translate(${x + 14}px, ${y + 14}px)`
    }

    // runs at most once per frame, however many mouse events arrived
    const probeHover = () => {
      const [x, y] = state.probe!
      const hit = pick(x, y)
      const pin = hit?.pin ? state.pins.find((p) => p.id === hit.pin) : null
      const region = hit?.region ? state.regionData?.byId.get(hit.region) : null
      const country = hit?.a2 ? BY_A2.get(hit.a2) : null
      showTip(
        pin
          ? `📍 ${pin.name}`
          : region
            ? `${flag(region.a2)} ${regionName(region, state.lang)}`
            : country
              ? `${flag(country.a2)} ${countryName(country, state.lang)}`
              : null,
        x,
        y,
      )
      canvas.style.cursor = pin || region || country ? 'pointer' : 'grab'
      state.hover = pin || region ? null : (hit?.a2 ?? null)
      state.hoverRegion = pin ? null : (region?.id ?? null)
    }

    /** Zooms by a factor; on the flat map the point under the pointer stays where it is. */
    const zoomAt = (x: number, y: number, factor: number) => {
      const { view, size, mode } = state
      const before = view.zoom
      view.zoom = clamp(before * factor, minZoom(mode), MAX_ZOOM)
      if (mode !== 'flat' || view.zoom === before) return
      const base = baseScale('flat', size.w, size.h)
      const [cx, cy] = flatCentre(view)
      const dx = x - size.w / 2
      const dy = size.h / 2 - y
      const shift = 1 / (base * before) - 1 / (base * view.zoom)
      setFlatCentre(view, cx + dx * shift, cy + dy * shift)
      keepFlatInView(view, size.w, size.h)
    }

    const pointers = new Map<number, { x: number; y: number }>()
    let travelled = 0
    // a finger wobbles more than a mouse, so a touch needs to travel further before it counts as a drag
    let dragging = false
    let pinch = 0
    let lastMove = 0

    const down = (e: PointerEvent) => {
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        // pointer already gone; dragging still works while it stays over the canvas
      }
      const [x, y] = local(e)
      pointers.set(e.pointerId, { x, y })
      if (pointers.size === 1) {
        travelled = 0
        dragging = false
      }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinch = Math.hypot(a.x - b.x, a.y - b.y)
      }
      state.fly = null
      state.velocity = { lng: 0, lat: 0 }
    }

    const move = (e: PointerEvent) => {
      const [x, y] = local(e)
      const prev = pointers.get(e.pointerId)

      if (!prev) {
        if (e.pointerType !== 'mouse') return
        if (!tip.hidden) tip.style.transform = `translate(${x + 14}px, ${y + 14}px)`
        state.probe = [x, y]
        state.request()
        return
      }

      pointers.set(e.pointerId, { x, y })
      if (e.pointerType === 'mouse') state.probe = [x, y]

      if (pointers.size === 2) {
        state.moving = true
        clearTimeout(state.settle)
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch)
        pinch = d
        dragging = true
      } else {
        const dx = x - prev.x
        const dy = y - prev.y
        travelled += Math.abs(dx) + Math.abs(dy)
        if (travelled > (e.pointerType === 'mouse' ? 4 : 10)) {
          dragging = true
          state.moving = true
          clearTimeout(state.settle)
          const scale = baseScale(state.mode, state.size.w, state.size.h) * state.view.zoom
          const k = 57.3 / scale
          if (state.mode === 'flat') {
            // the map follows the finger exactly, whatever the latitude
            const [cx, cy] = flatCentre(state.view)
            setFlatCentre(state.view, cx - dx / scale, cy + dy / scale)
            keepFlatInView(state.view, state.size.w, state.size.h)
          } else {
            state.view.lng = state.view.lng - dx * k
            state.view.lat = clamp(state.view.lat + dy * k, -85, 85)
          }
          // capped in pixels, so one large jump between events can't fling the map
          // wildly; a cap in degrees would let a close-up view fly off a whole country
          state.velocity = { lng: -clamp(dx, -36, 36) * k, lat: clamp(dy, -36, 36) * k }
          lastMove = performance.now()
          state.hover = null
          state.hoverRegion = null
          tip.hidden = true
          canvas.style.cursor = 'grabbing'
        }
      }
      state.request()
    }

    const up = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return
      pinch = 0
      if (pointers.size) return
      canvas.style.cursor = 'grab'

      const [x, y] = local(e)
      // look again at what is under the mouse once the button is let go
      if (e.pointerType === 'mouse') state.probe = [x, y]
      if (!dragging && e.type === 'pointerup') {
        const hit = pick(x, y)
        const color = hit && state.onPick(hit)
        if (hit && color && !reducedMotion()) {
          state.pulses.push({ lng: hit.lng, lat: hit.lat, color, t: 0, start: performance.now() })
        }
      }

      if (performance.now() - lastMove > 60 || reducedMotion()) state.velocity = { lng: 0, lat: 0 }
      state.request()
    }

    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      state.fly = null
      state.moving = true
      // a trackpad pinch arrives as ctrl+wheel with much smaller deltas than scrolling
      const speed = e.ctrlKey ? 0.012 : 0.0022
      const [x, y] = local(e)
      zoomAt(x, y, Math.exp(-e.deltaY * speed))
      state.request()
    }

    const leave = () => {
      tip.hidden = true
      state.probe = null
      if (state.hover || state.hoverRegion) {
        state.hover = null
        state.hoverRegion = null
        state.request()
      }
    }

    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('pointerleave', leave)
    canvas.addEventListener('wheel', wheel, { passive: false })

    return () => {
      disposed = true
      photo.removeEventListener('webglcontextlost', lost)
      photo.removeEventListener('webglcontextrestored', restored)
      resize.disconnect()
      cancelAnimationFrame(state.frame)
      state.frame = 0
      clearTimeout(state.settle)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('pointerleave', leave)
      canvas.removeEventListener('wheel', wheel)
    }
  }, [state])

  return (
    <div className="globe" ref={wrapRef}>
      <div className="globe-layers">
        <canvas className="globe-photo" ref={photoRef} aria-hidden="true" />
        <canvas ref={canvasRef} aria-label={STRINGS[lang].canvasLabel} role="img" />
      </div>
      <div className="globe-tip" ref={tipRef} hidden />
    </div>
  )
})

export default Globe
