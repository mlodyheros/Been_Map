import data from './data/countries.json'

export type Status = 'visited' | 'lived' | 'transit' | 'wish'
export type ContinentId = 'EU' | 'AS' | 'AF' | 'NA' | 'SA' | 'OC' | 'AN'
export type Statuses = Record<string, Status>

export interface Country {
  a2: string
  n3: string | null
  name: string
  en: string
  cont: ContinentId
  area: number
  lat: number
  lng: number
  ind: boolean
}

export const COUNTRIES = data as Country[]
export const BY_A2 = new Map(COUNTRIES.map((c) => [c.a2, c]))

export const CONTINENT_IDS: ContinentId[] = ['EU', 'AS', 'AF', 'NA', 'SA', 'OC', 'AN']

export const STATUSES: { id: Status; color: string }[] = [
  { id: 'visited', color: '#FF5A36' },
  { id: 'lived', color: '#141833' },
  { id: 'transit', color: '#FFB21A' },
  { id: 'wish', color: '#17B890' },
]
/** Ring colour of the "know people from" marker. */
export const PEOPLE_COLOR = '#E91E8C'
export const STATUS_BY_ID = Object.fromEntries(STATUSES.map((s) => [s.id, s])) as Record<
  Status,
  (typeof STATUSES)[number]
>

/** "Been there" for stats purposes: transit and wishlist don't count. */
export const isBeen = (s: Status | undefined) => s === 'visited' || s === 'lived'

export const flag = (a2: string) =>
  String.fromCodePoint(...[...a2].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65))

export const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

export function landShareLabel(share: number) {
  const pct = share * 100
  if (pct > 0 && pct < 1) return '<1%'
  return `${Math.round(pct)}%`
}

export interface Stats {
  been: number
  total: number
  territories: number
  transit: number
  wish: number
  people: number
  landShare: number
  continents: { id: ContinentId; been: number; total: number }[]
}

export function computeStats(statuses: Statuses, people: ReadonlySet<string>): Stats {
  let been = 0
  let total = 0
  let territories = 0
  let transit = 0
  let wish = 0
  let areaBeen = 0
  let areaTotal = 0
  const per = new Map(CONTINENT_IDS.map((id) => [id, { id, been: 0, total: 0 }]))

  for (const c of COUNTRIES) {
    const s = statuses[c.a2]
    const b = isBeen(s)
    if (s === 'transit') transit++
    if (s === 'wish') wish++
    if (c.cont !== 'AN') {
      areaTotal += c.area
      if (b) areaBeen += c.area
    }
    if (c.ind) {
      total++
      per.get(c.cont)!.total++
      if (b) {
        been++
        per.get(c.cont)!.been++
      }
    } else if (b) territories++
  }

  return {
    been,
    total,
    territories,
    transit,
    wish,
    people: people.size,
    landShare: areaTotal ? areaBeen / areaTotal : 0,
    continents: [...per.values()].filter((c) => c.total > 0),
  }
}

const KEY = 'been-map:v1'

/** Keeps only known countries and statuses from untrusted input (storage, the server). */
export function cleanStatuses(raw: unknown): Statuses {
  const out: Statuses = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [a2, s] of Object.entries(raw)) {
    if (BY_A2.has(a2) && typeof s === 'string' && s in STATUS_BY_ID) out[a2] = s as Status
  }
  return out
}

export function cleanPeople(raw: unknown): Set<string> {
  return new Set((Array.isArray(raw) ? raw : []).filter((a2) => typeof a2 === 'string' && BY_A2.has(a2)))
}

export function loadStatuses(): Statuses {
  try {
    return cleanStatuses(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
  } catch {
    return {}
  }
}

export function saveStatuses(statuses: Statuses) {
  try {
    localStorage.setItem(KEY, JSON.stringify(statuses))
  } catch {
    // storage unavailable (private mode) — the map still works for this visit
  }
}

const PEOPLE_KEY = 'been-map:people:v1'

export function loadPeople(): Set<string> {
  try {
    return cleanPeople(JSON.parse(localStorage.getItem(PEOPLE_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

export function savePeople(people: ReadonlySet<string>) {
  try {
    localStorage.setItem(PEOPLE_KEY, JSON.stringify([...people]))
  } catch {
    // see saveStatuses
  }
}

export type MapMode = 'globe' | 'flat'
export interface Settings {
  lang: 'pl' | 'en'
  mode: MapMode
}

const SETTINGS_KEY = 'been-map:settings:v1'

export function loadSettings(): Settings {
  const fallback: Settings = { lang: navigator.language.toLowerCase().startsWith('pl') ? 'pl' : 'en', mode: 'globe' }
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    return {
      lang: raw.lang === 'pl' || raw.lang === 'en' ? raw.lang : fallback.lang,
      mode: raw.mode === 'flat' || raw.mode === 'globe' ? raw.mode : fallback.mode,
    }
  } catch {
    return fallback
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // see saveStatuses
  }
}

// Which account the locally stored map belongs to. Unset while the map is anonymous.
const OWNER_KEY = 'been-map:owner:v1'

export function loadOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}

export function saveOwner(userId: string | null) {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId)
    else localStorage.removeItem(OWNER_KEY)
  } catch {
    // see saveStatuses
  }
}
