import { BY_A2, STATUS_BY_ID, type Status, type Statuses } from './model'

/** A place marked on the map: a city picked from the search, or a point tapped by hand. */
export interface Pin {
  id: string
  name: string
  lat: number
  lng: number
  /** Country the place is in, when known. */
  cc?: string
}

/** How a trip was made. */
export const TRANSPORTS = ['plane', 'car', 'train', 'bus', 'ship', 'bike', 'moto', 'foot'] as const
export type Transport = (typeof TRANSPORTS)[number]

/** One journey to a country: when, how, and anything worth remembering about it. */
export interface Trip {
  id: string
  /** Year and month, as "2024-07". */
  date?: string
  text?: string
  transport?: Transport[]
  /** Ids of photos kept on this device (see photos.ts). */
  photos?: string[]
}

/** Everything on a personal map beyond the country markings. */
export interface Extras {
  pins: Pin[]
  /** Markings of states, provinces and the like, keyed by ISO 3166-2 code ("US-CA"). */
  regions: Statuses
  /** Journeys by country, in the order they were added. */
  trips: Record<string, Trip[]>
}

export const EMPTY_EXTRAS: Extras = { pins: [], regions: {}, trips: {} }
export const PIN_COLOR = '#1E9BFF'
export const MAX_PINS = 500
export const MAX_NOTE = 500
export const MAX_TRIPS = 12
export const MAX_PHOTOS = 10

export const newTripId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
export const tripIsEmpty = (t: Trip) => !t.date && !t.text && !t.transport?.length && !t.photos?.length

function cleanTrip(raw: unknown, fallbackId: string): Trip | null {
  if (!raw || typeof raw !== 'object') return null
  const { id, date, text, transport, photos } = raw as Record<string, unknown>
  const trip: Trip = { id: typeof id === 'string' && /^[\w:-]{1,24}$/.test(id) ? id : fallbackId }
  if (typeof date === 'string' && DATE.test(date)) trip.date = date
  if (typeof text === 'string' && text.trim()) trip.text = text.slice(0, MAX_NOTE)
  if (Array.isArray(transport)) {
    const kinds = TRANSPORTS.filter((k) => transport.includes(k))
    if (kinds.length) trip.transport = kinds
  }
  if (Array.isArray(photos)) {
    const ids = [...new Set(photos.filter((p): p is string => typeof p === 'string' && /^[\w-]{1,40}$/.test(p)))]
    if (ids.length) trip.photos = ids.slice(0, MAX_PHOTOS)
  }
  return tripIsEmpty(trip) ? null : trip
}

const REGION_ID = /^[A-Z]{2}-[A-Z0-9]{1,3}$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])$/

/** Keeps only well-formed data from untrusted input (storage, the server). */
export function cleanExtras(raw: unknown): Extras {
  const out: Extras = { pins: [], regions: {}, trips: {} }
  if (!raw || typeof raw !== 'object') return out
  const { pins, regions, notes } = raw as Record<string, unknown>

  if (Array.isArray(pins)) {
    const seen = new Set<string>()
    for (const p of pins.slice(0, MAX_PINS)) {
      if (!p || typeof p !== 'object') continue
      const { id, name, lat, lng, cc } = p as Record<string, unknown>
      if (typeof id !== 'string' || !id || seen.has(id) || typeof name !== 'string') continue
      if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue
      seen.add(id)
      out.pins.push({
        id: id.slice(0, 40),
        name: name.slice(0, 60),
        lat,
        lng,
        ...(typeof cc === 'string' && BY_A2.has(cc) ? { cc } : {}),
      })
    }
  }

  if (regions && typeof regions === 'object') {
    for (const [id, s] of Object.entries(regions)) {
      if (REGION_ID.test(id) && typeof s === 'string' && s in STATUS_BY_ID) out.regions[id] = s as Status
    }
  }

  // Stored as "notes": the first trip's fields, then the rest under "more".
  // (The name is what the public link leaves out, and what older versions read.)
  if (notes && typeof notes === 'object') {
    for (const [a2, n] of Object.entries(notes)) {
      if (!BY_A2.has(a2) || !n || typeof n !== 'object') continue
      const more = (n as Record<string, unknown>).more
      const seen = new Set<string>()
      const trips: Trip[] = []
      for (const [i, raw] of [n, ...(Array.isArray(more) ? more : [])].entries()) {
        const trip = cleanTrip(raw, `${a2}${i}`)
        if (!trip || seen.has(trip.id) || trips.length >= MAX_TRIPS) continue
        seen.add(trip.id)
        trips.push(trip)
      }
      if (trips.length) out.trips[a2] = trips
    }
  }
  return out
}

/** The shape kept in storage and on the server. */
export function storedExtras(extras: Extras) {
  const notes: Record<string, Trip & { more?: Trip[] }> = {}
  for (const [a2, trips] of Object.entries(extras.trips)) {
    const [first, ...more] = trips.filter((t) => !tripIsEmpty(t))
    if (first) notes[a2] = more.length ? { ...first, more } : first
  }
  return { pins: extras.pins, regions: extras.regions, notes }
}

/** Adds what was marked before signing in to what the account already holds. */
export function mergeExtras(local: Extras, remote: Extras): Extras {
  const ids = new Set(remote.pins.map((p) => p.id))
  const trips = { ...remote.trips }
  for (const [a2, mine] of Object.entries(local.trips)) {
    const known = new Set((trips[a2] ?? []).map((t) => t.id))
    trips[a2] = [...(trips[a2] ?? []), ...mine.filter((t) => !known.has(t.id))].slice(0, MAX_TRIPS)
  }
  return {
    pins: [...remote.pins, ...local.pins.filter((p) => !ids.has(p.id))].slice(0, MAX_PINS),
    regions: { ...local.regions, ...remote.regions },
    trips,
  }
}

export const hasExtras = (e: Extras) =>
  e.pins.length > 0 || Object.keys(e.regions).length > 0 || Object.keys(e.trips).length > 0

/** Every trip with its country, newest first; undated ones last. */
export const allTrips = (e: Extras) =>
  Object.entries(e.trips)
    .flatMap(([a2, trips]) => trips.map((trip) => ({ a2, trip })))
    .sort((a, b) => (b.trip.date ?? '').localeCompare(a.trip.date ?? ''))

const KEY = 'been-map:extras:v1'

export function loadExtras(): Extras {
  try {
    return cleanExtras(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
  } catch {
    return { pins: [], regions: {}, trips: {} }
  }
}

export function saveExtras(extras: Extras) {
  try {
    localStorage.setItem(KEY, JSON.stringify(storedExtras(extras)))
  } catch {
    // storage unavailable (private mode) — the map still works for this visit
  }
}

// Which account's places and notes the server is known to hold. Until an
// account has stored them once, what this device has is merged in rather than
// replaced, so nothing marked before the first sync is lost.
const SYNCED_KEY = 'been-map:extras-synced:v1'

export function loadExtrasSynced(): string | null {
  try {
    return localStorage.getItem(SYNCED_KEY)
  } catch {
    return null
  }
}

export function saveExtrasSynced(accountId: string | null) {
  try {
    if (accountId) localStorage.setItem(SYNCED_KEY, accountId)
    else localStorage.removeItem(SYNCED_KEY)
  } catch {
    // see saveExtras
  }
}
