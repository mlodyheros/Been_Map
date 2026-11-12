import { geoBounds, geoCentroid, geoContains, geoDistance } from 'd3-geo'
import { feature } from 'topojson-client'
import { presimplify, quantile, simplify } from 'topojson-simplify'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'
import atlasUrl from 'world-atlas/countries-50m.json?url'
import { COUNTRIES } from './model'

export interface Shape {
  /** Null for land that belongs to no listed country (disputed areas): drawn, not clickable. */
  a2: string | null
  feature: Feature<Polygon | MultiPolygon>
  bounds: [[number, number], [number, number]]
  /** Centre and angular radius (radians) of a circle containing the shape, for culling. */
  centre: [number, number]
  radius: number
}

export interface Layer {
  shapes: Shape[]
}

export interface World {
  /** The same countries at increasing detail; the last one is the full atlas. */
  levels: Layer[]
  detail: Layer
}

// Share of the atlas's points each level keeps. Every level is cut from the
// same data, so countries keep their shape as the map moves and zooms.
const KEEP = [0.1, 0.25, 0.55, 1]
/** Zoom below which each level is used; past the last one the full atlas is drawn. */
const LEVEL_UNTIL = [1.4, 2.4, 4.5]

// Shapes without an ISO numeric code in the atlas, matched by name.
const NAMED: Record<string, string> = { Kosovo: 'XK', Somaliland: 'SO', 'N. Cyprus': 'CY' }
const N3_TO_A2 = new Map(COUNTRIES.filter((c) => c.n3).map((c) => [c.n3!, c.a2]))

type Atlas = Topology<{ countries: GeometryCollection<{ name: string }> }>

const features = (topo: Atlas) =>
  feature(topo, topo.objects.countries).features as Feature<Polygon | MultiPolygon, { name: string }>[]

export async function loadWorld(): Promise<World> {
  const atlas = (await fetch(atlasUrl).then((r) => r.json())) as Atlas
  const weighted = presimplify(atlas)

  // culling data comes from the full shapes and is shared by every level
  const full = features(atlas)
  const meta = full.map((f) => {
    const bounds = geoBounds(f)
    const centre = geoCentroid(f)
    const [[w, s], [e, n]] = bounds
    // spans that wrap the antimeridian or cover a pole are never culled
    const wide = w > e || e - w > 150 || n - s > 120
    const corners: [number, number][] = [
      [w, s],
      [w, n],
      [e, s],
      [e, n],
    ]
    const radius = wide ? Math.PI : Math.max(...corners.map((c) => geoDistance(centre, c))) + 0.02
    return { a2: N3_TO_A2.get(String(f.id ?? '')) ?? NAMED[f.properties.name] ?? null, bounds, centre, radius }
  })

  const levels = KEEP.map((keep): Layer => {
    const list = keep === 1 ? full : features(simplify(weighted, quantile(weighted, keep)) as Atlas)
    return { shapes: list.map((f, i) => ({ ...meta[i], feature: f })) }
  })
  return { levels, detail: levels[levels.length - 1] }
}

export function levelFor(world: World, zoom: number): Layer {
  const i = LEVEL_UNTIL.findIndex((until) => zoom < until)
  return world.levels[i === -1 ? world.levels.length - 1 : i]
}

/** `hint` is the country found last time; the pointer is usually still inside it. */
export function countryAt(layer: Layer, lng: number, lat: number, hint?: string | null): string | null {
  if (hint) {
    for (const s of layer.shapes) if (s.a2 === hint && geoContains(s.feature, [lng, lat])) return hint
  }
  for (const s of layer.shapes) {
    if (!s.a2) continue
    const [[w, south], [e, north]] = s.bounds
    if (lat < south || lat > north) continue
    // bounds that cross the antimeridian come back with west > east
    if (w <= e ? lng < w || lng > e : lng < w && lng > e) continue
    if (geoContains(s.feature, [lng, lat])) return s.a2
  }
  return null
}
