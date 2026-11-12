import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { countryAt, loadWorld, type World } from './geo'
import { countryName, STRINGS, type Lang } from './i18n'
import { BY_A2, flag, type MapMode, type Statuses } from './model'
import {
  DOT_BELOW_KM2,
  baseScale,
  makeProjection,
  paintMap,
  paintOverlay,
  patchCountries,
  type Pulse,
  type View,
} from './paint'

export interface GlobeHandle {
  flyTo(a2: string): void
  zoomBy(factor: number): void
  /** Renders the map as it currently looks onto a fresh square canvas. */
  snapshot(size: number): HTMLCanvasElement
}

interface Props {
  statuses: Statuses
  people: ReadonlySet<string>
  mode: MapMode
  lang: Lang
  /** Applies the active marking; returns its colour, or null when the tap cleared it. */
  onPick(a2: string): string | null
}

const MIN_ZOOM = 0.8
const MAX_ZOOM = 10
const START: View = { lng: 15, lat: 38, zoom: 1 }
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const Globe = forwardRef<GlobeHandle, Props>(function Globe({ statuses, people, mode, lang, onPick }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  // Everything the render loop reads lives in one mutable object so that
  // dragging never goes through React.
  const state = useRef({
    view: { ...START },
    world: null as World | null,
    statuses,
    people,
    mode,
    lang,
    onPick,
    size: { w: 0, h: 0 },
    hover: null as string | null,
    /** Pointer position waiting for a hover lookup on the next frame. */
    probe: null as [number, number] | null,
    /** Bumped whenever the cached frame has to be repainted from scratch. */
    version: 0,
    /** Countries whose fill changed and can be repainted on top of the cached frame. */
    patch: new Set<string>(),
    painted: { statuses, people, mode },
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
  state.mode = mode
  state.lang = lang
  state.onPick = onPick

  useEffect(() => {
    const before = state.painted
    state.painted = { statuses, people, mode }
    const changed = [...new Set([...Object.keys(before.statuses), ...Object.keys(statuses)])].filter(
      (a2) => before.statuses[a2] !== statuses[a2],
    )
    // A tapped country is patched into the cached frame. Anything that may need
    // pixels outside that country erased (rings, dots, a new projection) repaints.
    const patchable =
      before.people === people &&
      before.mode === mode &&
      changed.length <= 8 &&
      changed.every((a2) => (BY_A2.get(a2)?.area ?? 0) >= DOT_BELOW_KM2)
    if (patchable) for (const a2 of changed) state.patch.add(a2)
    else state.version++
    state.request()
  }, [statuses, people, mode, state])

  useImperativeHandle(ref, () => ({
    flyTo(a2) {
      const c = BY_A2.get(a2)
      if (!c) return
      const zoom = c.area < 30_000 ? 4.5 : c.area < 400_000 ? 2.8 : c.area < 2_500_000 ? 1.9 : 1.3
      const to = { lng: c.lng, lat: clamp(c.lat, -80, 80), zoom }
      state.velocity = { lng: 0, lat: 0 }
      if (reducedMotion()) state.view = to
      else state.fly = { from: { ...state.view }, to, start: performance.now(), ms: 900 }
      state.request()
    },
    zoomBy(factor) {
      state.view.zoom = clamp(state.view.zoom * factor, MIN_ZOOM, MAX_ZOOM)
      state.request()
    },
    snapshot(size) {
      const out = document.createElement('canvas')
      out.width = out.height = size
      paintMap(out.getContext('2d')!, size, size, {
        mode: state.mode,
        view: state.view,
        layer: state.world?.detail ?? null,
        statuses: state.statuses,
        people: state.people,
      })
      return out
    },
  }))

  useEffect(() => {
    const wrap = wrapRef.current!
    const canvas = canvasRef.current!
    const tip = tipRef.current!
    const ctx = canvas.getContext('2d')!
    let disposed = false

    const draw = (now: number) => {
      state.frame = 0
      const { view, size } = state
      let animating = false

      if (state.fly) {
        const { from, to, start, ms } = state.fly
        const t = clamp((now - start) / ms, 0, 1)
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
        const dLng = ((to.lng - from.lng + 540) % 360) - 180
        view.lng = from.lng + dLng * e
        view.lat = from.lat + (to.lat - from.lat) * e
        view.zoom = from.zoom + (to.zoom - from.zoom) * e
        if (t < 1) animating = true
        else state.fly = null
      } else if (Math.abs(state.velocity.lng) + Math.abs(state.velocity.lat) > 0.02) {
        view.lng += state.velocity.lng
        view.lat = clamp(view.lat + state.velocity.lat, -85, 85)
        state.velocity.lng *= 0.93
        state.velocity.lat *= 0.93
        animating = true
      }

      state.pulses = state.pulses.filter((p) => now - p.start < 600)
      for (const p of state.pulses) p.t = (now - p.start) / 600

      const moving = animating || state.moving
      if (state.probe && !moving) probeHover()
      state.probe = null

      const layer = state.world ? (moving ? state.world.coarse : state.world.detail) : null
      const dpr = Math.min(devicePixelRatio || 1, 2)
      const scene = { mode: state.mode, view, layer, statuses: state.statuses, people: state.people }

      // A still map is painted once and kept as a bitmap, so hovering and
      // click rings only cost a blit plus the overlay.
      const key = [state.mode, view.lng, view.lat, view.zoom, canvas.width, canvas.height, state.version].join('|')
      if (!moving && layer && state.cache && state.cacheKey === key) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(state.cache, 0, 0)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        if (state.patch.size) {
          patchCountries(ctx, size.w, size.h, scene, state.patch)
          state.cache.getContext('2d')!.drawImage(canvas, 0, 0)
        }
      } else {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        paintMap(ctx, size.w, size.h, scene)
        if (!moving && layer) {
          const cache = (state.cache ??= document.createElement('canvas'))
          cache.width = canvas.width
          cache.height = canvas.height
          cache.getContext('2d')!.drawImage(canvas, 0, 0)
          state.cacheKey = key
        }
      }
      state.patch.clear()
      if (state.hover || state.pulses.length) {
        paintOverlay(ctx, size.w, size.h, scene, { hover: state.hover, pulses: state.pulses })
      }

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
        state.fly = { from: { lng: START.lng - 70, lat: 8, zoom: 0.9 }, to: { ...START }, start: performance.now(), ms: 1400 }
      }
      state.request()
    })

    const local = (e: PointerEvent | WheelEvent) => {
      const box = canvas.getBoundingClientRect()
      return [e.clientX - box.left, e.clientY - box.top] as [number, number]
    }

    const pick = (x: number, y: number) => {
      const { world, size, view } = state
      if (!world) return null
      const projection = makeProjection(state.mode, size.w, size.h, view)
      const at = projection.invert?.([x, y])
      // points outside the map outline don't survive a round trip
      const back = at && projection(at)
      if (!at || !back || Math.hypot(back[0] - x, back[1] - y) > 1) return null
      return { a2: countryAt(world.detail, at[0], at[1], state.hover), at }
    }

    const showTip = (a2: string | null, x: number, y: number) => {
      const c = a2 ? BY_A2.get(a2) : null
      if (!c) {
        tip.hidden = true
        return
      }
      tip.hidden = false
      tip.textContent = `${flag(c.a2)} ${countryName(c, state.lang)}`
      tip.style.transform = `translate(${x + 14}px, ${y + 14}px)`
    }

    // runs at most once per frame, however many mouse events arrived
    const probeHover = () => {
      const [x, y] = state.probe!
      const hit = pick(x, y)?.a2 ?? null
      showTip(hit, x, y)
      canvas.style.cursor = hit ? 'pointer' : 'grab'
      state.hover = hit
    }

    const pointers = new Map<number, { x: number; y: number }>()
    let travelled = 0
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
      if (pointers.size === 1) travelled = 0
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
      state.moving = true
      clearTimeout(state.settle)

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch) state.view.zoom = clamp((state.view.zoom * d) / pinch, MIN_ZOOM, MAX_ZOOM)
        pinch = d
        travelled = 99
      } else {
        const dx = x - prev.x
        const dy = y - prev.y
        travelled += Math.abs(dx) + Math.abs(dy)
        if (travelled > 4) {
          const k = 57.3 / (baseScale(state.mode, state.size.w, state.size.h) * state.view.zoom)
          state.view.lng -= dx * k
          state.view.lat = clamp(state.view.lat + dy * k, -85, 85)
          // capped so one large jump between events can't spin the globe wildly
          state.velocity = { lng: clamp(-dx * k, -4, 4), lat: clamp(dy * k, -4, 4) }
          lastMove = performance.now()
          if (state.hover) state.hover = null
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

      if (travelled <= 4 && e.type === 'pointerup') {
        const [x, y] = local(e)
        const hit = pick(x, y)
        if (hit?.a2) {
          const color = state.onPick(hit.a2)
          if (color && !reducedMotion()) {
            state.pulses.push({ lng: hit.at[0], lat: hit.at[1], color, t: 0, start: performance.now() })
          }
        }
      }

      if (performance.now() - lastMove > 60 || reducedMotion()) state.velocity = { lng: 0, lat: 0 }
      state.request()
    }

    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      state.fly = null
      state.moving = true
      state.view.zoom = clamp(state.view.zoom * Math.exp(-e.deltaY * 0.0022), MIN_ZOOM, MAX_ZOOM)
      state.request()
    }

    const leave = () => {
      tip.hidden = true
      state.probe = null
      if (state.hover) {
        state.hover = null
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
      <canvas ref={canvasRef} aria-label={STRINGS[lang].canvasLabel} role="img" />
      <div className="globe-tip" ref={tipRef} hidden />
    </div>
  )
})

export default Globe
