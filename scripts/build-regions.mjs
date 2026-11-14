// Builds public/regions.json (the shapes) and src/data/region-countries.json
// (which countries have them): states, provinces, voivodeships and the like.
//
//   node scripts/build-regions.mjs path/to/ne_10m_admin_1_states_provinces.geojson
//
// The input is Natural Earth's "admin 1" layer (public domain), from
// https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { geoArea, geoBounds, geoContains } from 'd3-geo'
import { feature, merge } from 'topojson-client'
import { topology } from 'topojson-server'
import { presimplify, quantile, simplify } from 'topojson-simplify'

/** Countries whose first-level divisions are used as they are. */
const DIRECT = [
  // Americas
  'US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'EC', 'BO', 'UY', 'PY', 'VE', 'CU', 'CR', 'GT', 'PA', 'DO',
  // Europe
  'PL', 'DE', 'AT', 'CH', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'RS', 'BA', 'ME', 'AL', 'GR', 'PT', 'NL', 'BE',
  'DK', 'NO', 'SE', 'FI', 'EE', 'LT', 'IE', 'IS', 'UA', 'BY',
  // Asia
  'RU', 'CN', 'IN', 'JP', 'KR', 'TW', 'TH', 'VN', 'MY', 'ID', 'KZ', 'UZ', 'MN', 'NP', 'LK', 'KH', 'LA', 'MM',
  'IR', 'SA', 'AE', 'TR', 'GE', 'AM', 'IL', 'JO', 'OM',
  // Africa
  'ZA', 'EG', 'MA', 'TN', 'KE', 'TZ', 'NG', 'ET', 'GH', 'SN',
  // Oceania
  'AU', 'NZ',
]

/**
 * Countries whose first-level divisions are too fine to be useful (UK
 * districts, Spanish and Italian provinces, French departments): their pieces
 * are merged into the larger regions people actually talk about.
 * Keyed by the Natural Earth field that names the larger region.
 */
const GROUPED = {
  GB: {
    key: (p) => p.geonunit,
    regions: {
      England: ['GB-ENG', 'Anglia', 'England'],
      Scotland: ['GB-SCT', 'Szkocja', 'Scotland'],
      Wales: ['GB-WLS', 'Walia', 'Wales'],
      'Northern Ireland': ['GB-NIR', 'Irlandia Północna', 'Northern Ireland'],
    },
  },
  ES: {
    key: (p) => p.region,
    regions: {
      Andalucía: ['ES-AN', 'Andaluzja', 'Andalusia'],
      Aragón: ['ES-AR', 'Aragonia', 'Aragon'],
      Asturias: ['ES-AS', 'Asturia', 'Asturias'],
      Cantabria: ['ES-CB', 'Kantabria', 'Cantabria'],
      Ceuta: ['ES-CE', 'Ceuta', 'Ceuta'],
      Melilla: ['ES-ML', 'Melilla', 'Melilla'],
      'Castilla y León': ['ES-CL', 'Kastylia i León', 'Castile and León'],
      'Castilla-La Mancha': ['ES-CM', 'Kastylia-La Mancha', 'Castilla–La Mancha'],
      'Canary Is.': ['ES-CN', 'Wyspy Kanaryjskie', 'Canary Islands'],
      Cataluña: ['ES-CT', 'Katalonia', 'Catalonia'],
      Extremadura: ['ES-EX', 'Estremadura', 'Extremadura'],
      Galicia: ['ES-GA', 'Galicja', 'Galicia'],
      'La Rioja': ['ES-RI', 'La Rioja', 'La Rioja'],
      Madrid: ['ES-MD', 'Madryt', 'Madrid'],
      Murcia: ['ES-MC', 'Murcja', 'Murcia'],
      'Foral de Navarra': ['ES-NC', 'Nawarra', 'Navarre'],
      'Islas Baleares': ['ES-IB', 'Baleary', 'Balearic Islands'],
      'País Vasco': ['ES-PV', 'Kraj Basków', 'Basque Country'],
      Valenciana: ['ES-VC', 'Walencja', 'Valencia'],
    },
  },
  IT: {
    key: (p) => p.region_cod,
    regions: {
      'IT-21': ['IT-21', 'Piemont', 'Piedmont'],
      'IT-23': ['IT-23', 'Dolina Aosty', 'Aosta Valley'],
      'IT-25': ['IT-25', 'Lombardia', 'Lombardy'],
      'IT-32': ['IT-32', 'Trydent-Górna Adyga', 'Trentino-South Tyrol'],
      'IT-34': ['IT-34', 'Wenecja Euganejska', 'Veneto'],
      'IT-36': ['IT-36', 'Friuli-Wenecja Julijska', 'Friuli-Venezia Giulia'],
      'IT-42': ['IT-42', 'Liguria', 'Liguria'],
      'IT-45': ['IT-45', 'Emilia-Romania', 'Emilia-Romagna'],
      'IT-52': ['IT-52', 'Toskania', 'Tuscany'],
      'IT-55': ['IT-55', 'Umbria', 'Umbria'],
      'IT-57': ['IT-57', 'Marche', 'Marche'],
      'IT-62': ['IT-62', 'Lacjum', 'Lazio'],
      'IT-65': ['IT-65', 'Abruzja', 'Abruzzo'],
      'IT-67': ['IT-67', 'Molise', 'Molise'],
      'IT-72': ['IT-72', 'Kampania', 'Campania'],
      'IT-75': ['IT-75', 'Apulia', 'Apulia'],
      'IT-77': ['IT-77', 'Basilicata', 'Basilicata'],
      'IT-78': ['IT-78', 'Kalabria', 'Calabria'],
      'IT-82': ['IT-82', 'Sycylia', 'Sicily'],
      'IT-88': ['IT-88', 'Sardynia', 'Sardinia'],
    },
  },
  FR: {
    key: (p) => p.region_cod?.trim(),
    regions: {
      'FR-ARA': ['FR-ARA', 'Owernia-Rodan-Alpy', 'Auvergne-Rhône-Alpes'],
      'FR-BFC': ['FR-BFC', 'Burgundia-Franche-Comté', 'Bourgogne-Franche-Comté'],
      'FR-BRE': ['FR-BRE', 'Bretania', 'Brittany'],
      'FR-COR': ['FR-COR', 'Korsyka', 'Corsica'],
      'FR-CVL': ['FR-CVL', 'Centrum-Dolina Loary', 'Centre-Val de Loire'],
      'FR-GES': ['FR-GES', 'Grand Est', 'Grand Est'],
      'FR-GUA': ['FR-GUA', 'Gwadelupa', 'Guadeloupe'],
      'FR-GUF': ['FR-GUF', 'Gujana Francuska', 'French Guiana'],
      'FR-HDF': ['FR-HDF', 'Hauts-de-France', 'Hauts-de-France'],
      'FR-IDF': ['FR-IDF', 'Île-de-France', 'Île-de-France'],
      'FR-LRE': ['FR-LRE', 'Reunion', 'Réunion'],
      'FR-MAY': ['FR-MAY', 'Majotta', 'Mayotte'],
      'FR-MTQ': ['FR-MTQ', 'Martynika', 'Martinique'],
      'FR-NAQ': ['FR-NAQ', 'Nowa Akwitania', 'Nouvelle-Aquitaine'],
      'FR-NOR': ['FR-NOR', 'Normandia', 'Normandy'],
      'FR-OCC': ['FR-OCC', 'Oksytania', 'Occitanie'],
      'FR-PAC': ['FR-PAC', 'Prowansja-Alpy-Lazurowe Wybrzeże', "Provence-Alpes-Côte d'Azur"],
      'FR-PDL': ['FR-PDL', 'Kraj Loary', 'Pays de la Loire'],
    },
  },
}

/** Share of the outline points kept: enough for a clean shape at full zoom. */
const KEEP = Number(process.argv[3] ?? 0.03)
const ID = /^[A-Z]{2}-[A-Z0-9]{1,3}$/

// Polish names in Natural Earth often carry the kind of division in front.
const plName = (name) =>
  name.replace(/^(województwo|prowincja|stan|region|obwód|kraj|okręg|departament|hrabstwo|gubernatorstwo) /i, '')

const source = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const regionFeature = (geometry, id, a2, pl, en) => ({ type: 'Feature', geometry, properties: { id, a2, pl, en } })

const features = []

/** Names for codes that Natural Earth splits over several pieces (merged below). */
const SPLIT_NAMES = {
  'BA-BIH': ['Federacja Bośni i Hercegowiny', 'Federation of Bosnia and Herzegovina'],
  'CO-CUN': ['Cundinamarca i Bogota', 'Cundinamarca and Bogotá'],
  'IR-07': ['Teheran', 'Tehran'],
  'KZ-ALA': ['Ałmaty', 'Almaty'],
  'HR-12': ['brodzko-posawska', 'Brod-Posavina'],
  'LA-VI': ['Wientian', 'Vientiane'],
}

/** Joins pieces into one shape, removing the borders between them. */
function mergePieces(pieces) {
  if (pieces.length === 1) return pieces[0].geometry
  const topo = topology({ pieces: { type: 'FeatureCollection', features: pieces } }, 1e6)
  return merge(topo, topo.objects.pieces.geometries)
}

const direct = new Map()
for (const f of source.features) {
  const p = f.properties
  if (!DIRECT.includes(p.iso_a2) || !ID.test(p.iso_3166_2)) continue
  direct.set(p.iso_3166_2, [...(direct.get(p.iso_3166_2) ?? []), f])
}
for (const [id, pieces] of direct) {
  const p = pieces[0].properties
  const [pl, en] = SPLIT_NAMES[id] ?? [plName(p.name_pl || p.name), p.name_en || p.name]
  features.push(regionFeature(mergePieces(pieces), id, p.iso_a2, pl, en))
}

for (const [a2, { key, regions }] of Object.entries(GROUPED)) {
  const pieces = source.features.filter((f) => f.properties.iso_a2 === a2)
  const groups = new Map()
  for (const f of pieces) {
    const name = key(f.properties)
    if (!regions[name]) throw new Error(`${a2}: no name for region "${name}"`)
    groups.set(name, [...(groups.get(name) ?? []), f])
  }
  for (const [name, members] of groups) {
    const [id, pl, en] = regions[name]
    features.push(regionFeature(mergePieces(members), id, a2, pl, en))
  }
}

const full = topology({ regions: { type: 'FeatureCollection', features } }, 1e5)
const weighted = presimplify(full)

// Simplifying drops the points that matter least for the whole map, which can
// shrink a small region (Washington DC, Berlin, Prague) to a sliver or make a
// tiny one (Ceuta) vanish. Small regions count their points as weightier, and
// the tiniest keep their outline whole: they have few points, so it costs little.
const SMALL_KM2 = 5000
const TINY_KM2 = 300
const R = 6371
const arcsOf = (g) => (g.type === 'Polygon' ? g.arcs.flat() : g.type === 'MultiPolygon' ? g.arcs.flat(2) : [])
weighted.objects.regions.geometries.forEach((g, i) => {
  const km2 = geoArea(features[i]) * R * R
  if (km2 >= SMALL_KM2) return
  for (const arc of arcsOf(g)) {
    for (const point of weighted.arcs[arc < 0 ? ~arc : arc]) point[2] = km2 < TINY_KM2 ? Infinity : point[2] * 30
  }
})
// The pieces of land that big cities stand on keep their outline, so a tap on
// a city lands in the right region even when it sits on a small island
// (Manhattan, Venice, Singapore-like spots) that would otherwise be lost.
const cities = createRequire(import.meta.url)('all-the-cities').filter((c) => c.population >= 300_000)
let anchored = 0
weighted.objects.regions.geometries.forEach((g, i) => {
  const polygons = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : []
  const [[w, s], [e, n]] = geoBounds(features[i])
  const inside = cities.filter((c) => {
    const [lng, lat] = c.loc.coordinates
    return lat >= s && lat <= n && (w <= e ? lng >= w && lng <= e : lng >= w || lng <= e)
  })
  if (!inside.length) return
  for (const rings of polygons) {
    const shape = feature(weighted, { type: 'Polygon', arcs: rings })
    if (!inside.some((c) => geoContains(shape, c.loc.coordinates))) continue
    const km2 = geoArea(shape) * R * R
    for (const arc of rings.flat()) {
      for (const point of weighted.arcs[arc < 0 ? ~arc : arc]) point[2] = km2 < 2000 ? Infinity : point[2] * 4
    }
    anchored++
  }
})

// Regions made only of small islands can still disappear entirely; boost
// those that did and simplify again, until every region has a shape.
const threshold = quantile(weighted, KEEP)
const vanished = (topo) =>
  feature(topo, topo.objects.regions)
    .features.map((f, i) => (!f.geometry || geoArea(f) === 0 ? i : -1))
    .filter((i) => i >= 0)
let slim = simplify(weighted, threshold)
for (let round = 0, lost = vanished(slim); lost.length && round < 4; round++, lost = vanished(slim)) {
  for (const i of lost) {
    for (const arc of arcsOf(weighted.objects.regions.geometries[i])) {
      for (const point of weighted.arcs[arc < 0 ? ~arc : arc]) point[2] = round < 3 ? point[2] * 30 : Infinity
    }
  }
  slim = simplify(weighted, threshold)
}

// Report anything the app will have to repair or will not be able to show.
const out = feature(slim, slim.objects.regions).features
const empty = out.filter((f) => !f.geometry).map((f) => f.properties.id)
const inverted = out.filter((f) => f.geometry && geoArea(f) > 2 * Math.PI).map((f) => f.properties.id)
const countries = [...new Set(features.map((f) => f.properties.a2))].sort()
const ids = features.map((f) => f.properties.id)
const repeated = ids.filter((id, i) => ids.indexOf(id) !== i)
if (repeated.length) throw new Error(`repeated region codes: ${repeated.join(', ')}`)

writeFileSync(new URL('../public/regions.json', import.meta.url), JSON.stringify(slim))
writeFileSync(new URL('../src/data/region-countries.json', import.meta.url), JSON.stringify(countries))
// how many regions each country has, for progress and achievements without loading the shapes
const counts = Object.fromEntries(countries.map((a2) => [a2, features.filter((f) => f.properties.a2 === a2).length]))
writeFileSync(new URL('../src/data/region-counts.json', import.meta.url), JSON.stringify(counts))
console.log(`${features.length} regions in ${countries.length} countries; ${anchored} pieces of land kept whole around big cities`)
if (empty.length) console.log(`lost in simplification: ${empty.join(', ')}`)
if (inverted.length) console.log(`inside-out after simplification (repaired when loaded): ${inverted.join(', ')}`)
