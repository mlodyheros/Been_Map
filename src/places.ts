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

// The list mostly uses English (sometimes local) names; these are the Polish
// ones people are likely to type. Keys and values are already folded.
const POLISH: [string, string][] = [
  ['warszawa', 'warsaw'], ['praga', 'prague'], ['rzym', 'rome'], ['paryz', 'paris'], ['londyn', 'london'],
  ['wieden', 'vienna'], ['lizbona', 'lisbon'], ['ateny', 'athens'], ['kopenhaga', 'copenhagen'],
  ['sztokholm', 'stockholm'], ['bruksela', 'brussels'], ['moskwa', 'moscow'], ['kijow', 'kyiv'],
  ['wilno', 'vilnius'], ['ryga', 'riga'], ['tallin', 'tallinn'], ['budapeszt', 'budapest'],
  ['bukareszt', 'bucharest'], ['sofia', 'sofia'], ['nowy jork', 'new york city'], ['pekin', 'beijing'],
  ['tokio', 'tokyo'], ['wenecja', 'venice'], ['mediolan', 'milan'], ['neapol', 'naples'], ['turyn', 'turin'],
  ['genua', 'genoa'], ['florencja', 'florence'], ['monachium', 'munich'], ['kolonia', 'koln'],
  ['norymberga', 'nurnberg'], ['drezno', 'dresden'], ['lipsk', 'leipzig'], ['frankfurt nad menem', 'frankfurt am main'],
  ['genewa', 'geneva'], ['zurych', 'zurich'], ['bazylea', 'basel'], ['stambul', 'istanbul'], ['kair', 'cairo'],
  ['dubaj', 'dubai'], ['lwow', 'lviv'], ['belgrad', 'belgrade'], ['zagrzeb', 'zagreb'], ['lublana', 'ljubljana'],
  ['bratyslawa', 'bratislava'], ['minsk', 'minsk'], ['sewilla', 'sevilla'], ['walencja', 'valencia'],
  ['marsylia', 'marseille'], ['nicea', 'nice'], ['strasburg', 'strasbourg'], ['tuluza', 'toulouse'],
  ['haga', 'the hague'], ['antwerpia', 'antwerpen'], ['luksemburg', 'luxembourg'], ['edynburg', 'edinburgh'],
  ['rejkiawik', 'reykjavik'], ['meksyk', 'mexico city'], ['waszyngton', 'washington, d.c.'], ['seul', 'seoul'],
  ['jerozolima', 'jerusalem'], ['tbilisi', 'tbilisi'], ['erywan', 'yerevan'], ['teheran', 'tehran'],
  ['bagdad', 'baghdad'], ['delhi', 'delhi'], ['bombaj', 'mumbai'], ['szanghaj', 'shanghai'],
  ['kapsztad', 'cape town'], ['hawana', 'havana'], ['petersburg', 'saint petersburg'],
  ['krolewiec', 'kaliningrad'], ['wladywostok', 'vladivostok'], ['gandawa', 'gent'], ['brugia', 'brugge'],
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
