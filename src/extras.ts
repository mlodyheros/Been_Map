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

/** When a country was visited and anything worth remembering about it. */
export interface Note {
  /** Year and month, as "2024-07". */
  date?: string
  text?: string
}

/** Everything on a personal map beyond the country markings. */
export interface Extras {
  pins: Pin[]
  /** Markings of states, provinces and the like, keyed by ISO 3166-2 code ("US-CA"). */
  regions: Statuses
  notes: Record<string, Note>
}

export const EMPTY_EXTRAS: Extras = { pins: [], regions: {}, notes: {} }
export const PIN_COLOR = '#1E9BFF'
export const MAX_PINS = 500
export const MAX_NOTE = 500

const REGION_ID = /^[A-Z]{2}-[A-Z0-9]{1,3}$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])$/

/** Keeps only well-formed data from untrusted input (storage, the server). */
export function cleanExtras(raw: unknown): Extras {
  const out: Extras = { pins: [], regions: {}, notes: {} }
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

  if (notes && typeof notes === 'object') {
    for (const [a2, n] of Object.entries(notes)) {
      if (!BY_A2.has(a2) || !n || typeof n !== 'object') continue
      const { date, text } = n as Record<string, unknown>
      const note: Note = {}
      if (typeof date === 'string' && DATE.test(date)) note.date = date
      if (typeof text === 'string' && text.trim()) note.text = text.slice(0, MAX_NOTE)
      if (note.date || note.text) out.notes[a2] = note
    }
  }
  return out
}

/** Adds what was marked before signing in to what the account already holds. */
export function mergeExtras(local: Extras, remote: Extras): Extras {
  const ids = new Set(remote.pins.map((p) => p.id))
  return {
    pins: [...remote.pins, ...local.pins.filter((p) => !ids.has(p.id))].slice(0, MAX_PINS),
    regions: { ...local.regions, ...remote.regions },
    notes: { ...local.notes, ...remote.notes },
  }
}

export const hasExtras = (e: Extras) =>
  e.pins.length > 0 || Object.keys(e.regions).length > 0 || Object.keys(e.notes).length > 0

const KEY = 'been-map:extras:v1'

export function loadExtras(): Extras {
  try {
    return cleanExtras(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
  } catch {
    return { pins: [], regions: {}, notes: {} }
  }
}

export function saveExtras(extras: Extras) {
  try {
    localStorage.setItem(KEY, JSON.stringify(extras))
  } catch {
    // storage unavailable (private mode) — the map still works for this visit
  }
}
