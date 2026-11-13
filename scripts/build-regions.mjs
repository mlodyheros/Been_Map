// Builds public/regions.json: states, provinces and voivodeships of the
// countries large enough to be worth marking part by part.
//
//   node scripts/build-regions.mjs path/to/ne_10m_admin_1_states_provinces.geojson
//
// The input is Natural Earth's "admin 1" layer (public domain), from
// https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
import { readFileSync, writeFileSync } from 'node:fs'
import { topology } from 'topojson-server'
import { presimplify, quantile, simplify } from 'topojson-simplify'

const COUNTRIES = ['US', 'CA', 'MX', 'BR', 'AR', 'AU', 'RU', 'CN', 'IN', 'PL', 'DE']
/** Share of the outline points kept: enough for a clean shape at full zoom. */
const KEEP = Number(process.argv[3] ?? 0.035)

const source = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const features = source.features
  .filter((f) => COUNTRIES.includes(f.properties.iso_a2) && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(f.properties.iso_3166_2))
  .map((f) => ({
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      id: f.properties.iso_3166_2,
      a2: f.properties.iso_a2,
      pl: f.properties.name_pl || f.properties.name,
      en: f.properties.name_en || f.properties.name,
    },
  }))

const full = topology({ regions: { type: 'FeatureCollection', features } }, 1e5)
const weighted = presimplify(full)
const slim = simplify(weighted, quantile(weighted, KEEP))
writeFileSync(new URL('../public/regions.json', import.meta.url), JSON.stringify(slim))
console.log(`${features.length} regions`)
