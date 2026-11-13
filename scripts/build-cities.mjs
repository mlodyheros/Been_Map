// Builds public/cities.json: every city with at least 50,000 people, for the
// place search and for naming pins dropped on the map.
// Rows are [name, country code, latitude, longitude, population in thousands].
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'

const cities = createRequire(import.meta.url)('all-the-cities')
const rows = cities
  .filter((c) => c.population >= 50_000)
  .sort((a, b) => b.population - a.population)
  .map((c) => [
    c.name,
    c.country,
    Math.round(c.loc.coordinates[1] * 1000) / 1000,
    Math.round(c.loc.coordinates[0] * 1000) / 1000,
    Math.round(c.population / 1000),
  ])

writeFileSync(new URL('../public/cities.json', import.meta.url), JSON.stringify(rows))
console.log(`${rows.length} cities`)
