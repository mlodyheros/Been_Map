// Builds public/cities.json for the place search and for naming pins dropped
// on the map: every town of 5,000 people or more (in Poland from 1,000), plus
// every capital and regional seat however small.
// Rows are [name, country code, latitude, longitude, population in thousands].
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'

const cities = createRequire(import.meta.url)('all-the-cities')
const rows = cities
  .filter((c) => c.population >= (c.country === 'PL' ? 1_000 : 5_000) || c.featureCode === 'PPLC' || c.featureCode === 'PPLA')
  .sort((a, b) => b.population - a.population)
  .map((c) => [
    c.name,
    c.country,
    Math.round(c.loc.coordinates[1] * 1000) / 1000,
    Math.round(c.loc.coordinates[0] * 1000) / 1000,
    Math.max(1, Math.round(c.population / 1000)),
  ])

writeFileSync(new URL('../public/cities.json', import.meta.url), JSON.stringify(rows))
console.log(`${rows.length} cities`)
