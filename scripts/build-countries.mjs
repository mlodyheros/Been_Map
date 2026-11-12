// Generates src/data/countries.json from the world-countries package.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const source = require('world-countries')

const continent = (c) => {
  if (c.region === 'Americas') return c.subregion === 'South America' ? 'SA' : 'NA'
  return { Europe: 'EU', Asia: 'AS', Africa: 'AF', Oceania: 'OC', Antarctic: 'AN' }[c.region]
}

const countries = source
  .map((c) => ({
    a2: c.cca2,
    n3: c.ccn3 || null,
    name: c.translations?.pol?.common ?? c.name.common,
    en: c.name.common,
    cont: continent(c),
    area: Math.max(0, Math.round(c.area)),
    lat: c.latlng[0],
    lng: c.latlng[1],
    ind: c.independent === true || c.cca2 === 'XK',
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'pl'))

writeFileSync(new URL('../src/data/countries.json', import.meta.url), JSON.stringify(countries))
console.log(`countries.json: ${countries.length} entries, ${countries.filter((c) => c.ind).length} independent`)
