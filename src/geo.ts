import { geoBounds, geoContains } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import type { Feature, MultiLineString, MultiPolygon, Polygon } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'
import url50 from 'world-atlas/countries-50m.json?url'
import url110 from 'world-atlas/countries-110m.json?url'
import { COUNTRIES } from './model'

export interface Shape {
  a2: string
  feature: Feature<Polygon | MultiPolygon>
  bounds: [[number, number], [number, number]]
}

export interface Layer {
  /** Interactive country shapes. */
  shapes: Shape[]
  /** Land that belongs to no listed country (disputed areas); drawn, not clickable. */
  inert: Feature[]
  borders: MultiLineString
}

export interface World {
  detail: Layer
  /** Coarse geometry used while the globe is moving. */
  coarse: Layer
}

// Shapes without an ISO numeric code in the atlas, matched by name.
const NAMED: Record<string, string> = { Kosovo: 'XK', Somaliland: 'SO', 'N. Cyprus': 'CY' }
const N3_TO_A2 = new Map(COUNTRIES.filter((c) => c.n3).map((c) => [c.n3!, c.a2]))

function toLayer(topo: Topology): Layer {
  const object = topo.objects.countries as GeometryCollection<{ name: string }>
  const shapes: Shape[] = []
  const inert: Feature[] = []
  for (const f of feature(topo, object).features) {
    const a2 = N3_TO_A2.get(String(f.id ?? '')) ?? NAMED[f.properties.name]
    if (a2) {
      const poly = f as Feature<Polygon | MultiPolygon>
      shapes.push({ a2, feature: poly, bounds: geoBounds(poly) })
    } else inert.push(f)
  }
  return { shapes, inert, borders: mesh(topo, object) }
}

export async function loadWorld(): Promise<World> {
  const [detail, coarse] = await Promise.all(
    [url50, url110].map((u) => fetch(u).then((r) => r.json() as Promise<Topology>)),
  )
  return { detail: toLayer(detail), coarse: toLayer(coarse) }
}

/** `hint` is the country found last time; the pointer is usually still inside it. */
export function countryAt(layer: Layer, lng: number, lat: number, hint?: string | null): string | null {
  if (hint) {
    for (const s of layer.shapes) if (s.a2 === hint && geoContains(s.feature, [lng, lat])) return hint
  }
  for (const s of layer.shapes) {
    const [[w, south], [e, north]] = s.bounds
    if (lat < south || lat > north) continue
    // bounds that cross the antimeridian come back with west > east
    if (w <= e ? lng < w || lng > e : lng < w && lng > e) continue
    if (geoContains(s.feature, [lng, lat])) return s.a2
  }
  return null
}
