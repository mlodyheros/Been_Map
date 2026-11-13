import { useEffect, useState } from 'react'
import { geoBounds, geoCentroid, geoContains, geoDistance } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'
import type { Shape } from './geo'
import type { Lang } from './i18n'

/** Countries that can be marked state by state. Kept in step with scripts/build-regions.mjs. */
export const REGION_COUNTRIES = new Set(['US', 'CA', 'MX', 'BR', 'AR', 'AU', 'RU', 'CN', 'IN', 'PL', 'DE'])

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
        .map((f): Region => {
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
