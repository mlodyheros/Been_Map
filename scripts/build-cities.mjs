// Builds public/cities.json for the place search and for naming pins dropped
// on the map: every town of 15,000 people or more, and in Poland from 5,000.
// Rows are [name, country code, latitude, longitude, population in thousands].
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'

const cities = createRequire(import.meta.url)('all-the-cities')
const rows = cities
  .filter((c) => c.population >= (c.country === 'PL' ? 5_000 : 15_000))
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
