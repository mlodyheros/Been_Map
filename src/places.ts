import { fold } from './model'

export interface City {
  name: string
  cc: string
  lat: number
  lng: number
  /** Population in thousands. */
  pop: number
  /** Name lower-cased and stripped of accents, for searching. */
  key: string
}

let pending: Promise<City[]> | null = null

/** Every city of 50,000 people or more, largest first. Fetched once, on first use. */
export function loadCities(): Promise<City[]> {
  pending ??= fetch('cities.json')
    .then((r) => r.json())
    .then((rows: [string, string, number, number, number][]) =>
      rows.map(([name, cc, lat, lng, pop]) => ({ name, cc, lat, lng, pop, key: fold(name) })),
    )
    .catch((error) => {
      pending = null // allow another try
      throw error
    })
  return pending
}

// The list has English names; these are the Polish ones people are most likely to type.
const POLISH: [string, string][] = [
  ['warszawa', 'warsaw'], ['praga', 'prague'], ['rzym', 'rome'], ['paryz', 'paris'], ['londyn', 'london'],
  ['wieden', 'vienna'], ['lizbona', 'lisbon'], ['ateny', 'athens'], ['kopenhaga', 'copenhagen'],
  ['sztokholm', 'stockholm'], ['bruksela', 'brussels'], ['moskwa', 'moscow'], ['kijow', 'kyiv'],
  ['wilno', 'vilnius'], ['ryga', 'riga'], ['budapeszt', 'budapest'], ['bukareszt', 'bucharest'],
  ['nowy jork', 'new york city'], ['pekin', 'beijing'], ['tokio', 'tokyo'], ['wenecja', 'venice'],
  ['mediolan', 'milan'], ['neapol', 'naples'], ['monachium', 'munich'], ['kolonia', 'cologne'],
  ['genewa', 'geneva'], ['zurych', 'zurich'], ['florencja', 'florence'], ['stambul', 'istanbul'],
  ['kair', 'cairo'], ['dubaj', 'dubai'], ['lwow', 'lviv'], ['belgrad', 'belgrade'], ['zagrzeb', 'zagreb'],
]

/** Cities whose name starts with the query come first, then those that contain it; largest first within each. */
export function searchCities(cities: City[], query: string, limit: number): City[] {
  const q = fold(query.trim())
  if (q.length < 2) return []
  const named = new Set(POLISH.filter(([pl]) => pl.startsWith(q)).map(([, en]) => en))
  const starts: City[] = named.size ? cities.filter((c) => named.has(c.key)).slice(0, limit) : []
  const contains: City[] = []
  for (const c of cities) {
    if (named.has(c.key)) continue
    const at = c.key.indexOf(q)
    if (at === 0) starts.push(c)
    else if (at > 0 && contains.length < limit) contains.push(c)
    if (starts.length >= limit) break
  }
  return [...starts, ...contains].slice(0, limit)
}

const RAD = Math.PI / 180
const km = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const x = (bLng - aLng) * RAD * Math.cos(((aLat + bLat) / 2) * RAD)
  const y = (bLat - aLat) * RAD
  return Math.hypot(x, y) * 6371
}

/** The city a tapped point most likely means: the nearest one within reach, favouring big ones. */
export function nearestCity(cities: City[], lng: number, lat: number, withinKm: number): City | null {
  let best: City | null = null
  let bestScore = Infinity
  for (const c of cities) {
    if (Math.abs(c.lat - lat) > 1) continue
    const d = km(lat, lng, c.lat, c.lng)
    if (d > withinKm) continue
    // a metropolis 20 km away beats a suburb 5 km away
    const score = d / Math.log10(c.pop + 10)
    if (score < bestScore) {
      best = c
      bestScore = score
    }
  }
  return best
}

export const cityId = (c: City) => `c:${c.cc}:${c.key}:${c.lat.toFixed(1)}`
