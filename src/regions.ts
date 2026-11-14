import { useEffect, useState } from 'react'
import { geoArea, geoBounds, geoCentroid, geoContains, geoDistance } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
import countries from './data/region-countries.json'
import counts from './data/region-counts.json'
import type { GeometryCollection, Topology } from 'topojson-specification'
import type { Shape } from './geo'
import type { Lang } from './i18n'

/** Countries that can be marked region by region; written by scripts/build-regions.mjs. */
export const REGION_COUNTRIES = new Set<string>(countries)
/** How many regions each of those countries has. */
export const REGION_COUNTS: Record<string, number> = counts

/**
 * d3 reads a ring's direction to tell inside from outside. A ring stored the
 * other way round (simplifying a tiny shape can do that) covers the whole
 * globe except the shape itself, and then every tap anywhere lands in it.
 * Any polygon claiming more than half the sphere is turned the right way.
 */
function rightWayOut(geometry: Polygon | MultiPolygon): Polygon | MultiPolygon {
  const fix = (rings: Position[][]) =>
    geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI ? rings.map((r) => [...r].reverse()) : rings
  return geometry.type === 'Polygon'
    ? { ...geometry, coordinates: fix(geometry.coordinates) }
    : { ...geometry, coordinates: geometry.coordinates.map(fix) }
}

export interface Region extends Shape {
  /** ISO 3166-2 code, e.g. "US-CA". */
  id: string
  a2: string
  pl: string
  en: string
}

export interface Regions {
  shapes: Region[]
  byId: Map<string, Region>
  byCountry: Map<string, Region[]>
}

type Props = { id: string; a2: string; pl: string; en: string }
type File = Topology<{ regions: GeometryCollection<Props> }>

let pending: Promise<Regions> | null = null
let loaded: Regions | null = null

/** Fetched once, the first time regions are shown or listed. */
export function loadRegions(): Promise<Regions> {
  pending ??= fetch('regions.json')
    .then((r) => r.json())
    .then((file: File) => {
      const list = feature(file, file.objects.regions).features as Feature<Polygon | MultiPolygon, Props>[]
      const shapes = list
        .filter((f) => f.geometry)
        .map((raw): Region => {
          const f = { ...raw, geometry: rightWayOut(raw.geometry) }
          const bounds = geoBounds(f)
          const centre = geoCentroid(f)
          const [[w, s], [e, n]] = bounds
          const wide = w > e || e - w > 150 || n - s > 120
          const corners: [number, number][] = [
            [w, s],
            [w, n],
            [e, s],
            [e, n],
          ]
          const radius = wide ? Math.PI : Math.max(...corners.map((c) => geoDistance(centre, c))) + 0.02
          // Polish names arrive as "województwo mazowieckie"; the list already says they are regions
          const pl = f.properties.pl.replace(/^województwo /, '')
          return { ...f.properties, pl, feature: f, bounds, centre, radius }
        })
      const byCountry = new Map<string, Region[]>()
      for (const s of shapes) byCountry.set(s.a2, [...(byCountry.get(s.a2) ?? []), s])
      loaded = { shapes, byId: new Map(shapes.map((s) => [s.id, s])), byCountry }
      return loaded
    })
    .catch((error) => {
      pending = null // allow another try
      throw error
    })
  return pending
}

/** The regions if they have been fetched already; never starts a fetch. */
export const regionsNow = () => loaded

export const regionName = (r: Region, lang: Lang) => (lang === 'pl' ? r.pl : r.en)

export function regionAt(regions: Regions, lng: number, lat: number): Region | null {
  for (const s of regions.shapes) {
    const [[w, south], [e, north]] = s.bounds
    if (lat < south || lat > north) continue
    if (w <= e ? lng < w || lng > e : lng < w && lng > e) continue
    if (geoContains(s.feature, [lng, lat])) return s
  }
  return null
}

/** The regions for a component that needs them; fetches on first use once `want` is true. */
export function useRegions(want: boolean): Regions | null {
  const [data, setData] = useState(loaded)
  useEffect(() => {
    if (!want || data) return
    let current = true
    loadRegions().then(
      (regions) => current && setData(regions),
      () => {},
    )
    return () => {
      current = false
    }
  }, [want, data])
  return data
}

const RAD = Math.PI / 180

/**
 * For a tap that lands in a country with regions but in none of them: a thin
 * island like Manhattan can fall between simplified outlines. Picks the region
 * of that country with an outline point nearest to the tap, if one is close.
 */
export function nearestRegion(regions: Regions, a2: string, lng: number, lat: number, withinKm: number): Region | null {
  const cos = Math.cos(lat * RAD)
  let best: Region | null = null
  let bestKm = withinKm
  for (const r of regions.byCountry.get(a2) ?? []) {
    const g = r.feature.geometry
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (const [x, y] of ring) {
          const km = Math.hypot((x - lng) * cos, y - lat) * RAD * 6371
          if (km < bestKm) {
            bestKm = km
            best = r
          }
        }
      }
    }
  }
  return best
}
