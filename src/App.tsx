import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Account from './Account'
import { unlocked, ACHIEVEMENTS } from './achievements'
import CountryDetails from './CountryDetails'
import {
  fetchMap,
  fetchPublicMap,
  fetchSharedMap,
  flagShared,
  markShared,
  saveMap,
  supabase,
  watchSharedMap,
  type Account as AccountInfo,
  type CloudMap,
  type Friend,
  type SharedMapInfo,
} from './cloud'
import {
  EMPTY_EXTRAS,
  MAX_PINS,
  PIN_COLOR,
  loadExtras,
  loadExtrasSynced,
  mergeExtras,
  saveExtras,
  saveExtrasSynced,
  type Extras,
  type Trip,
  type Pin,
} from './extras'
import Globe, { type GlobeHandle, type Hit } from './Globe'
import { Achievements, AchievementsPage, Places, RegionProgress, Timeline } from './Insights'
import { LANGS, STRINGS, countryName, type Brush } from './i18n'
import {
  BY_A2,
  CONTINENT_IDS,
  COUNTRIES,
  MAP_STYLES,
  isDark,
  PEOPLE_COLOR,
  STATUSES,
  STATUS_BY_ID,
  computeStats,
  flag,
  fold,
  isBeen,
  landShareLabel,
  loadOwner,
  loadPeople,
  loadSettings,
  loadStatuses,
  saveOwner,
  savePeople,
  saveSettings,
  saveStatuses,
  type MapMode,
  type MapStyle,
  type Status,
  type Statuses,
} from './model'
import { COMPARE } from './paint'
import { cityId, loadCities, nearestCity, searchCities, type City } from './places'
import { REGION_COUNTRIES, regionName, regionsNow } from './regions'
import Share from './ShareDialog'
import { renderCard, type ShareFormat } from './share'

type Filter = 'all' | Brush

const BRUSHES: { id: Brush; color: string }[] = [...STATUSES, { id: 'people', color: PEOPLE_COLOR }]
const BRUSH_COLOR = Object.fromEntries(BRUSHES.map((b) => [b.id, b.color])) as Record<Brush, string>
const FILTERS: Filter[] = ['all', ...BRUSHES.map((b) => b.id)]
const MODES: MapMode[] = ['globe', 'flat']
type Page = 'map' | 'hub'
const PAGES: Page[] = ['map', 'hub']

type Viewing = CloudMap &
  ({ kind: 'friend'; username: string } | { kind: 'shared'; id: string; name: string; members: number })

type Snap = 'peek' | 'half' | 'full'
const PHONE = '(max-width: 900px)'

/**
 * On phones the panel is a bottom sheet with three resting positions. Returns
 * the sheet's offset from fully open, plus handlers for dragging it by the grip.
 */
function useSheet() {
  const sheet = useRef<HTMLElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const safeArea = useRef<HTMLElement>(null)
  const [phone, setPhone] = useState(() => matchMedia(PHONE).matches)
  const [snap, setSnap] = useState<Snap>('peek')
  const [size, setSize] = useState({ height: 0, peek: 0 })
  const drag = useRef<{ y0: number; from: number; at: number; moved: boolean } | null>(null)

  useEffect(() => {
    const query = matchMedia(PHONE)
    const update = () => setPhone(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useLayoutEffect(() => {
    if (!phone) return
    const measure = () =>
      setSize({
        height: sheet.current!.offsetHeight,
        peek: head.current!.offsetHeight + safeArea.current!.offsetHeight,
      })
    const observer = new ResizeObserver(measure)
    observer.observe(sheet.current!)
    observer.observe(head.current!)
    measure()
    return () => observer.disconnect()
  }, [phone])

  const closed = Math.max(0, size.height - size.peek)
  const offsets: Record<Snap, number> = { full: 0, half: Math.min(closed, Math.round(size.height * 0.45)), peek: closed }
  const offset = offsets[snap]
  const place = (y: number) => {
    sheet.current!.style.transform = `translateY(${y}px)`
  }

  const grip = {
    onPointerDown(e: React.PointerEvent) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // pointer already gone; the drag still works while it stays over the grip
      }
      drag.current = { y0: e.clientY, from: offset, at: offset, moved: false }
    },
    onPointerMove(e: React.PointerEvent) {
      const d = drag.current
      if (!d) return
      const dy = e.clientY - d.y0
      if (Math.abs(dy) > 5) d.moved = true
      if (!d.moved) return
      d.at = Math.min(closed, Math.max(0, d.from + dy))
      sheet.current!.classList.add('dragging')
      place(d.at)
    },
    onPointerUp() {
      const d = drag.current
      drag.current = null
      if (!d) return
      sheet.current!.classList.remove('dragging')
      let next: Snap
      if (!d.moved) next = snap === 'peek' ? 'half' : 'peek'
      else {
        // a deliberate drag moves at least one stop in its direction
        const order: Snap[] = ['full', 'half', 'peek']
        const nearest = order.reduce((a, b) => (Math.abs(offsets[b] - d.at) < Math.abs(offsets[a] - d.at) ? b : a))
        const step = Math.sign(d.at - d.from)
        next = nearest === snap && Math.abs(d.at - d.from) > 40 ? order[order.indexOf(snap) + step] ?? snap : nearest
      }
      place(offsets[next])
      setSnap(next)
    },
    onPointerCancel() {
      drag.current = null
      sheet.current?.classList.remove('dragging')
      place(offset)
    },
  }

  return { sheet, head, safeArea, phone, snap, setSnap, offset, peek: size.peek, grip }
}

const DownloadIcon = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 15.5h12" />
  </svg>
)

const GlobeIcon = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <circle cx="10" cy="10" r="7" />
    <path d="M3 10h14M10 3c2.4 2 2.4 12 0 14M10 3c-2.4 2-2.4 12 0 14" />
  </svg>
)

const MapIcon = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 5.5 7.5 4l5 1.5L17 4v10.5L12.5 16l-5-1.5L3 16zM7.5 4v10.5M12.5 5.5V16" />
  </svg>
)

const STYLE_ICONS: Record<MapStyle, React.ReactNode> = {
  plain: <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4M13.2 10a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 0 1 6.4 0Z" />,
  terrain: <path d="m2.5 15.5 5-9 3.2 5.4 1.8-2.6 5 6.2z" />,
  night: <path d="M16 11.6A6.5 6.5 0 0 1 8.4 4a6.5 6.5 0 1 0 7.6 7.6Z" />,
  relief: <path d="M2.5 16h15M4.5 12.5h11M7 9h6M9 5.5h2" />,
}
const StyleIcon = ({ id }: { id: MapStyle }) => (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {STYLE_ICONS[id]}
  </svg>
)

const ink = (color: string) => ({ '--status': color }) as React.CSSProperties
const NO_TRIPS: readonly Trip[] = []
/** The year of the latest dated trip, for the country's row. */
const tripYear = (trips: readonly Trip[] | undefined) =>
  trips?.map((t) => t.date?.slice(0, 4) ?? '').sort().pop() || null

export default function App() {
  const [statuses, setStatuses] = useState<Statuses>(loadStatuses)
  const [people, setPeople] = useState(loadPeople)
  const [settings, setSettings] = useState(loadSettings)
  const [brush, setBrush] = useState<Brush>('visited')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [page, setPage] = useState<Page>('map')
  const [sharing, setSharing] = useState(false)
  /** The full list of achievements is open in the dashboard. */
  const [badges, setBadges] = useState(false)
  const [extras, setExtras] = useState(loadExtras)
  /** Taps on the map drop place markers instead of marking countries. */
  const [pinMode, setPinMode] = useState(false)
  /** Taps mark states and provinces in the countries that have them. */
  const [regionLevel, setRegionLevel] = useState(false)
  /** The country whose details are open in the list. */
  const [open, setOpen] = useState<string | null>(null)
  /** While a friend's map is shown: colour it by who has been where. */
  const [compare, setCompare] = useState(true)
  const [cities, setCities] = useState<City[] | null>(null)
  const [syncFailed, setSyncFailed] = useState(false)
  /** A map shown in place of your own: a friend's (read-only) or a shared one (everyone marks it). */
  const [viewing, setViewing] = useState<Viewing | null>(null)
  const [toast, setToast] = useState<{ id: number; text: string; color: string | null } | null>(null)
  const globe = useRef<GlobeHandle>(null)
  const sheet = useSheet()

  const { lang, mode, style } = settings
  const t = STRINGS[lang]

  // The map's click handler needs the latest values without re-subscribing.
  const live = useRef({ statuses, people, extras, brush, pinMode, viewing, lang, cities })
  live.current = { statuses, people, extras, brush, pinMode, viewing, lang, cities }
  /** True once the signed-in account's map has been loaded, so local edits may be uploaded. */
  const cloudReady = useRef(false)
  /** Set when the map was just replaced wholesale (sign-in), so that is not announced as new achievements. */
  const quiet = useRef(false)

  useEffect(() => saveStatuses(statuses), [statuses])
  useEffect(() => savePeople(people), [people])
  useEffect(() => saveExtras(extras), [extras])

  // the city list is only fetched once someone searches or starts dropping pins
  const wantCities = pinMode || query.trim().length >= 2
  useEffect(() => {
    if (!wantCities || cities) return
    let current = true
    loadCities().then(
      (list) => current && setCities(list),
      () => {},
    )
    return () => {
      current = false
    }
  }, [wantCities, cities])
  useEffect(() => {
    saveSettings(settings)
    document.documentElement.lang = settings.lang
    document.title = STRINGS[settings.lang].title
  }, [settings])

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user
      setAccount((current) =>
        user
          ? current?.id === user.id && current.username === String(user.user_metadata.username ?? '')
            ? current
            : { id: user.id, username: String(user.user_metadata.username ?? '') }
          : null,
      )
      if (event === 'SIGNED_OUT') {
        // the map belongs to the account; don't leave it behind for the next person
        cloudReady.current = false
        saveOwner(null)
        saveExtrasSynced(null)
        setStatuses({})
        setPeople(new Set())
        setExtras(EMPTY_EXTRAS)
        setViewing(null)
        setSyncFailed(false)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // an account that came through Google or Apple has nothing to sync until it has picked a username
  const accountId = account?.username ? account.id : undefined
  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    cloudReady.current = false
    ;(async () => {
      try {
        const remote = await fetchMap(accountId)
        if (cancelled) return
        const owner = loadOwner()
        const local: CloudMap = { statuses: live.current.statuses, people: live.current.people }
        const empty: CloudMap = { statuses: {}, people: new Set() }
        const localExtras = live.current.extras
        const remoteExtras = remote?.extras ?? EMPTY_EXTRAS
        let next: CloudMap
        let nextExtras: Extras
        if (owner === accountId) {
          // the local copy is just this account's cache…
          next = remote ?? local
          // …except for places and notes made before the account first stored any
          nextExtras =
            loadExtrasSynced() === accountId && remote ? remoteExtras : mergeExtras(localExtras, remoteExtras)
        } else if (owner) {
          // cache left over from another account
          next = remote ?? empty
          nextExtras = remoteExtras
        } else {
          // first sign-in on this device: anonymous marks are added to the account's map
          next = remote
            ? {
                statuses: { ...local.statuses, ...remote.statuses },
                people: new Set([...local.people, ...remote.people]),
              }
            : local
          nextExtras = mergeExtras(localExtras, remoteExtras)
        }
        live.current.statuses = next.statuses
        live.current.people = next.people
        live.current.extras = nextExtras
        setStatuses(next.statuses)
        setPeople(next.people)
        setExtras(nextExtras)
        // loading a whole map is not the moment to announce achievements
        quiet.current = true
        setTimeout(() => (quiet.current = false), 1500)
        saveOwner(accountId)
        cloudReady.current = true
        // the account doesn't hold this exact map yet: store it now rather than on the next edit
        if (next !== remote || JSON.stringify(nextExtras) !== JSON.stringify(remoteExtras)) {
          await saveMap(accountId, { ...next, extras: nextExtras })
        }
        saveExtrasSynced(accountId)
        setSyncFailed(false)
      } catch {
        if (!cancelled) setSyncFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accountId])

  useEffect(() => {
    if (!accountId || !cloudReady.current) return
    const timer = setTimeout(() => {
      saveMap(accountId, { statuses, people, extras }).then(
        () => setSyncFailed(false),
        () => setSyncFailed(true),
      )
    }, 700)
    return () => clearTimeout(timer)
  }, [accountId, statuses, people, extras])

  const viewFriend = useCallback(async (friend: Friend) => {
    const map = await fetchMap(friend.userId)
    setViewing({
      kind: 'friend',
      username: friend.username,
      statuses: map?.statuses ?? {},
      people: map?.people ?? new Set(),
      // a friend's notes are theirs to read
      extras: { ...(map?.extras ?? EMPTY_EXTRAS), trips: {} },
    })
    setPage('map')
  }, [])
  const openShared = useCallback(async (info: SharedMapInfo) => {
    const map = await fetchSharedMap(info.id)
    setViewing({
      kind: 'shared',
      id: info.id,
      name: info.name,
      members: info.members.length,
      statuses: map?.statuses ?? {},
      people: map?.people ?? new Set(),
    })
    setPage('map')
  }, [])

  // While a shared map is open, pick up other people's marks: live where
  // realtime is available, and by re-reading every so often as a fallback.
  const sharedId = viewing?.kind === 'shared' ? viewing.id : null
  useEffect(() => {
    if (!sharedId) return
    const apply = (map: CloudMap) =>
      setViewing((current) => (current?.kind === 'shared' && current.id === sharedId ? { ...current, ...map } : current))
    const stop = watchSharedMap(sharedId, apply)
    const refresh = () =>
      fetchSharedMap(sharedId).then(
        (map) => (map ? apply(map) : setViewing(null)), // the map was deleted or you were removed
        () => {},
      )
    const timer = setInterval(refresh, 15000)
    addEventListener('focus', refresh)
    return () => {
      stop()
      clearInterval(timer)
      removeEventListener('focus', refresh)
    }
  }, [sharedId])

  // ?u=name opens that person's public map, read-only
  useEffect(() => {
    const name = new URLSearchParams(location.search).get('u')
    if (!name) return
    let current = true
    fetchPublicMap(name).then(
      (map) => {
        if (!current) return
        if (map) setViewing({ kind: 'friend', ...map })
        else setToast({ id: Date.now(), text: STRINGS[live.current.lang].account.notPublic, color: null })
      },
      () => current && setToast({ id: Date.now(), text: STRINGS[live.current.lang].account.notPublic, color: null }),
    )
    return () => {
      current = false
    }
  }, [])

  const stopViewing = () => {
    setViewing(null)
    // leaving a public map also drops it from the address, so a reload shows your own
    if (location.search) history.replaceState(null, '', location.pathname)
  }

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(timer)
  }, [toast])

  /**
   * Applies the active marking to a country; a second tap with the same marking clears it.
   * Returns the marking's colour, or null when it was cleared.
   */
  const toggle = useCallback((a2: string) => {
    const { statuses: own, people: ownPeople, brush: active, viewing: view, lang: language } = live.current
    if (view?.kind === 'friend') return null
    const current = view ?? { statuses: own, people: ownPeople }
    const country = BY_A2.get(a2)
    const label = country ? `${flag(a2)} ${countryName(country, language)}` : a2
    const words = STRINGS[language]

    let next: CloudMap
    let added: boolean
    if (active === 'people') {
      const known = new Set(current.people)
      added = !known.delete(a2)
      if (added) known.add(a2)
      next = { statuses: current.statuses, people: known }
    } else {
      const marks = { ...current.statuses }
      added = current.statuses[a2] !== active
      if (added) marks[a2] = active
      else {
        delete marks[a2]
        // a country that is no longer marked keeps no marked regions either
        const mine = live.current.extras
        const kept = Object.entries(mine.regions).filter(([id]) => !id.startsWith(`${a2}-`))
        if (!view && kept.length !== Object.keys(mine.regions).length) {
          const cleared = { ...mine, regions: Object.fromEntries(kept) }
          live.current.extras = cleared
          setExtras(cleared)
        }
      }
      next = { statuses: marks, people: current.people }
    }
    const color = added ? BRUSH_COLOR[active] : null
    setToast({
      id: Date.now(),
      text: added ? words.account.marked(label, words.brush[active]) : words.account.cleared(label),
      color,
    })

    if (view) {
      // shared map: show the change at once, then send just this one country
      const shared = { ...view, ...next }
      live.current.viewing = shared
      setViewing(shared)
      const sent =
        active === 'people' ? flagShared(view.id, a2, added) : markShared(view.id, a2, added ? active : null)
      sent.then(
        () => setSyncFailed(false),
        () => setSyncFailed(true),
      )
    } else {
      live.current.statuses = next.statuses
      live.current.people = next.people
      setStatuses(next.statuses)
      setPeople(next.people)
    }
    return color
  }, [])

  const commitExtras = useCallback((next: Extras) => {
    live.current.extras = next
    setExtras(next)
  }, [])

  /** Marks a state or province with the active status; a second tap clears it. */
  const toggleRegion = useCallback(
    (id: string) => {
      const { extras: mine, statuses: own, brush: active, viewing: view, lang: language } = live.current
      if (view) return null
      const words = STRINGS[language]
      const status: Status = active === 'people' ? 'visited' : active
      const added = mine.regions[id] !== status
      const regions = { ...mine.regions }
      if (added) regions[id] = status
      else delete regions[id]
      commitExtras({ ...mine, regions })
      // being in a state means being in the country
      const a2 = id.slice(0, 2)
      if (added && !own[a2]) {
        const marks = { ...own, [a2]: status }
        live.current.statuses = marks
        setStatuses(marks)
      }
      const region = regionsNow()?.byId.get(id)
      const label = `${flag(a2)} ${region ? regionName(region, language) : id}`
      const color = added ? STATUS_BY_ID[status].color : null
      setToast({
        id: Date.now(),
        text: added ? words.account.marked(label, words.brush[status]) : words.account.cleared(label),
        color,
      })
      return color
    },
    [commitExtras],
  )

  /** Marks all of a country's regions with the active status, or clears them. */
  const setRegions = useCallback(
    (ids: string[], on: boolean) => {
      const { extras: mine, statuses: own, brush: active, viewing: view } = live.current
      if (view || !ids.length) return
      const status: Status = active === 'people' ? 'visited' : active
      const regions = { ...mine.regions }
      for (const id of ids) {
        if (on) regions[id] = status
        else delete regions[id]
      }
      commitExtras({ ...mine, regions })
      const a2 = ids[0].slice(0, 2)
      if (on && !own[a2]) {
        const marks = { ...own, [a2]: status }
        live.current.statuses = marks
        setStatuses(marks)
      }
    },
    [commitExtras],
  )

  /** Adds the place, or removes it if it is already marked. */
  const togglePin = useCallback(
    (pin: Pin) => {
      const { extras: mine, viewing: view, lang: language } = live.current
      if (view) return null
      const words = STRINGS[language].places
      const has = mine.pins.some((p) => p.id === pin.id)
      if (!has && mine.pins.length >= MAX_PINS) return null
      commitExtras({ ...mine, pins: has ? mine.pins.filter((p) => p.id !== pin.id) : [...mine.pins, pin] })
      setToast({ id: Date.now(), text: has ? words.removed(pin.name) : words.added(pin.name), color: has ? null : PIN_COLOR })
      return has ? null : PIN_COLOR
    },
    [commitExtras],
  )

  const setTrips = useCallback(
    (a2: string, list: Trip[]) => {
      const trips = { ...live.current.extras.trips }
      if (list.length) trips[a2] = list
      else delete trips[a2]
      commitExtras({ ...live.current.extras, trips })
    },
    [commitExtras],
  )

  /** A tap on the map: a place, a region or a country, depending on what is being marked. */
  const pick = useCallback(
    (hit: Hit) => {
      const { viewing: view, pinMode: pinning, extras: mine, brush: active, lang: language, cities: known } = live.current
      if (view?.kind === 'friend') return null
      if (pinning && !view) {
        const existing = hit.pin ? mine.pins.find((p) => p.id === hit.pin) : null
        if (existing) return togglePin(existing)
        const city = known ? nearestCity(known, hit.lng, hit.lat, 30) : null
        if (city) return togglePin({ id: cityId(city), name: city.name, lat: city.lat, lng: city.lng, cc: city.cc })
        const country = hit.a2 ? BY_A2.get(hit.a2) : null
        return togglePin({
          id: `p:${Date.now().toString(36)}`,
          name: country ? countryName(country, language) : STRINGS[language].places.unnamed,
          lat: Math.round(hit.lat * 1000) / 1000,
          lng: Math.round(hit.lng * 1000) / 1000,
          ...(hit.a2 ? { cc: hit.a2 } : {}),
        })
      }
      if (hit.region && !view && active !== 'people') return toggleRegion(hit.region)
      return hit.a2 ? toggle(hit.a2) : null
    },
    [toggle, togglePin, toggleRegion],
  )

  const statsRef = useRef(computeStats({}, new Set()))
  const closeShare = useCallback(() => setSharing(false), [])
  const renderShare = useCallback(
    async (format: ShareFormat) =>
      globe.current ? renderCard(globe.current.snapshot(1600), statsRef.current, lang, style, format) : null,
    [lang, style],
  )

  const showPin = (pin: Pin) => {
    setPage('map')
    globe.current?.flyToPoint(pin.lng, pin.lat, 7)
    sheet.setSnap('peek')
  }

  const showOnMap = (a2: string) => {
    setPage('map')
    globe.current?.flyTo(a2)
    // on a phone the sheet would otherwise cover the country
    sheet.setSnap('peek')
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
  }

  /** Opens a country's details in the dashboard's list and brings them into view. */
  const openDetails = (a2: string) => {
    setQuery('')
    setFilter('all')
    setOpen(a2)
    requestAnimationFrame(() =>
      document.querySelector('.hub li[data-open]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    )
  }

  // everything below draws either your own map or the friend's map being viewed
  const own = { statuses, people }
  const shown = viewing ?? own
  const stats = useMemo(() => computeStats(shown.statuses, shown.people), [shown.statuses, shown.people])
  statsRef.current = stats
  const readOnly = viewing?.kind === 'friend'
  /** Places, regions and notes belong to personal maps; on a shared one there are none. */
  const shownExtras = viewing ? (viewing.extras ?? EMPTY_EXTRAS) : extras
  const comparing = readOnly && compare && Object.values(statuses).some(isBeen)

  // a newly earned achievement is announced once, on your own map
  const ownStats = useMemo(() => computeStats(statuses, people), [statuses, people])
  const earned = useMemo(() => unlocked({ statuses, people, stats: ownStats, extras }), [statuses, people, ownStats, extras])
  const earnedBefore = useRef(earned)
  useEffect(() => {
    const fresh = earned.filter((id) => !earnedBefore.current.includes(id))
    earnedBefore.current = earned
    if (quiet.current) return
    const last = ACHIEVEMENTS.find((a) => a.id === fresh[fresh.length - 1])
    if (!last) return
    // after the "marked" toast has had its moment
    const timer = setTimeout(
      () => setToast({ id: Date.now(), text: STRINGS[live.current.lang].achievements.unlocked(last.name[live.current.lang]), color: null }),
      900,
    )
    return () => clearTimeout(timer)
  }, [earned])

  const cityHits = useMemo(
    () => (cities && !viewing ? searchCities(cities, query, 6) : []),
    [cities, viewing, query],
  )
  const pinned = useMemo(() => new Set(shownExtras.pins.map((p) => p.id)), [shownExtras.pins])
  const compareCounts = useMemo(() => {
    const counts = { me: 0, them: 0, both: 0 }
    if (viewing?.kind !== 'friend') return counts
    for (const a2 of new Set([...Object.keys(statuses), ...Object.keys(viewing.statuses)])) {
      const mine = isBeen(statuses[a2])
      const theirs = isBeen(viewing.statuses[a2])
      if (mine && theirs) counts.both++
      else if (mine) counts.me++
      else if (theirs) counts.them++
    }
    return counts
  }, [viewing, statuses])
  const common = useMemo(
    () =>
      viewing?.kind === 'friend'
        ? Object.keys(viewing.statuses).filter((a2) => isBeen(viewing.statuses[a2]) && isBeen(statuses[a2])).length
        : 0,
    [viewing, statuses],
  )

  const sorted = useMemo(
    () => [...COUNTRIES].sort((a, b) => countryName(a, lang).localeCompare(countryName(b, lang), lang)),
    [lang],
  )

  const groups = useMemo(() => {
    const q = fold(query.trim())
    const rows = sorted.filter((c) => {
      const s = shown.statuses[c.a2]
      if (filter === 'people' ? !shown.people.has(c.a2) : filter !== 'all' && s !== filter) return false
      return !q || fold(c.name).includes(q) || fold(c.en).includes(q)
    })
    return CONTINENT_IDS.map((id) => ({ id, rows: rows.filter((c) => c.cont === id) })).filter((g) => g.rows.length)
  }, [query, filter, shown.statuses, shown.people, sorted])

  const extraStats = [
    [t.extras.territories, stats.territories],
    [t.extras.transit, stats.transit],
    [t.extras.wish, stats.wish],
    [t.extras.people, stats.people],
    [t.extras.places, shownExtras.pins.length],
    [t.extras.regions, Object.keys(shownExtras.regions).length],
  ] as const

  const title = (
    <>
      <h1>
        {viewing?.kind === 'friend'
          ? t.account.viewing(viewing.username)
          : viewing?.kind === 'shared'
            ? viewing.name
            : t.myMap}
      </h1>
      <p>
        {viewing?.kind === 'shared'
          ? `${t.account.shared} · ${t.account.people(viewing.members)}`
          : viewing?.kind === 'friend'
            ? t.account.common(common)
            : account?.username
              ? `@${account.username}`
              : t.localOnly}
      </p>
    </>
  )

  const progress = (
    <>
      {stats.continents.map((c) => (
        <div className="continent" key={c.id}>
          <span className="continent-name">{t.continents[c.id]}</span>
          <span className="continent-count">
            {c.been}/{c.total}
          </span>
          <span className="bar">
            <span style={{ width: `${(c.been / c.total) * 100}%` }} />
          </span>
        </div>
      ))}
      <p className="extras">
        {extraStats
          .filter(([, n]) => n > 0)
          .map(([label, n]) => `${label}: ${n}`)
          .join(' · ')}
      </p>
    </>
  )

  const pages = (
    <nav className="pages" role="tablist">
      {PAGES.map((id) => (
        <button key={id} role="tab" aria-selected={page === id} onClick={() => (setPage(id), setBadges(false))}>
          {t.pages[id]}
        </button>
      ))}
    </nav>
  )

  const modeSwitch = (
    <div className="switch" role="radiogroup" aria-label={t.viewLabel}>
      {MODES.map((m) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          aria-label={m === 'globe' ? t.globe : t.map}
          onClick={() => setSettings((s) => ({ ...s, mode: m }))}
        >
          {m === 'globe' ? <GlobeIcon /> : <MapIcon />}
          <span>{m === 'globe' ? t.globe : t.map}</span>
        </button>
      ))}
    </div>
  )

  const styleSwitch = (
    <div className="switch" role="radiogroup" aria-label={t.styleLabel}>
      {MAP_STYLES.map((id) => (
        <button
          key={id}
          role="radio"
          aria-checked={style === id}
          aria-label={t.styles[id]}
          title={t.styles[id]}
          onClick={() => setSettings((s) => ({ ...s, style: id }))}
        >
          <StyleIcon id={id} />
          <span>{t.styles[id]}</span>
        </button>
      ))}
    </div>
  )

  // on the map the bar also offers the place marker; in the dashboard there is no map to tap
  const brushBar = (onMap: boolean) => (
    <div className="brush" role="radiogroup" aria-label={t.brushLabel} hidden={readOnly}>
      <span className="brush-label">{t.brushLabel}</span>
      {BRUSHES.map((b) => (
        <button
          key={b.id}
          role="radio"
          aria-checked={brush === b.id && !(onMap && pinMode && !viewing)}
          className="brush-option"
          style={ink(b.color)}
          onClick={() => (setBrush(b.id), setPinMode(false))}
        >
          <i className={`swatch swatch-${b.id}`} />
          {t.brush[b.id]}
        </button>
      ))}
      {onMap && !viewing && (
        <button
          role="radio"
          aria-checked={pinMode}
          className="brush-option"
          style={ink(PIN_COLOR)}
          onClick={() => setPinMode(true)}
        >
          <i className="swatch" />
          {t.places.tool}
        </button>
      )}
    </div>
  )

  const tally = (
    <p className="tally">
      <span className="tally-number" key={stats.been}>
        {stats.been}
      </span>
      <span className="tally-text">
        <strong>{t.countriesOf(stats.been, stats.total)}</strong>
        <span>{t.landShare(landShareLabel(stats.landShare))}</span>
      </span>
    </p>
  )

  const finder = (
    <div className="finder">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t.search}
        aria-label={t.search}
        onFocus={() => sheet.setSnap('full')}
      />
      <div className="filters" role="tablist">
        {FILTERS.map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
            {f !== 'all' && <i className={`swatch swatch-${f}`} style={ink(BRUSH_COLOR[f])} />}
            {f === 'all' ? t.filters.all : t.brush[f]}
          </button>
        ))}
      </div>
    </div>
  )

  const rows = (
    <>
      {cityHits.length > 0 && (
        <section>
          <h2>{t.places.cities}</h2>
          <ul>
            {cityHits.map((c) => {
              const id = cityId(c)
              const country = BY_A2.get(c.cc)
              return (
                <li key={id}>
                  <button
                    className="row-mark"
                    data-on={pinned.has(id) || undefined}
                    style={ink(PIN_COLOR)}
                    onClick={() => {
                      if (togglePin({ id, name: c.name, lat: c.lat, lng: c.lng, cc: c.cc })) {
                        globe.current?.flyToPoint(c.lng, c.lat, 7)
                      }
                    }}
                  >
                    <span className="row-flag">{flag(c.cc)}</span>
                    <span className="row-label">
                      {c.name}
                      {country && <small>{countryName(country, lang)}</small>}
                    </span>
                    <i className="row-check" />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {groups.length === 0 && cityHits.length === 0 && (
        <p className="list-empty">{query ? t.noMatch(query) : filter === 'wish' ? t.emptyWish : t.emptyMarked}</p>
      )}
      {groups.map((g) => (
        <section key={g.id}>
          <h2>
            {t.continents[g.id]}
            <span>
              {g.rows.filter((c) => isBeen(shown.statuses[c.a2])).length}/{g.rows.length}
            </span>
          </h2>
          <ul>
            {g.rows.map((c) => {
              const s = shown.statuses[c.a2]
              const knows = shown.people.has(c.a2)
              const name = countryName(c, lang)
              // the circle shows the layer the brush edits: people ring or status fill
              const on = brush === 'people' ? knows : Boolean(s)
              const applied = brush === 'people' ? knows : s === brush
              return (
                <li key={c.a2} data-open={open === c.a2 || undefined}>
                  <button
                    className="row-mark"
                    data-on={on || undefined}
                    data-layer={brush === 'people' ? 'people' : s}
                    style={ink(brush === 'people' || !s ? BRUSH_COLOR[brush] : STATUS_BY_ID[s].color)}
                    onClick={() => toggle(c.a2)}
                    disabled={readOnly}
                    title={applied ? t.unmark(name) : t.mark(t.brush[brush], name)}
                  >
                    <span className="row-flag">{flag(c.a2)}</span>
                    <span className="row-label">{name}</span>
                    {knows && <i className="swatch swatch-people" style={ink(PEOPLE_COLOR)} title={t.peopleBadge} />}
                    {tripYear(shownExtras.trips[c.a2]) && <small className="row-year">{tripYear(shownExtras.trips[c.a2])}</small>}
                    {s && (
                      <span className="row-status" style={ink(STATUS_BY_ID[s].color)}>
                        {brush === 'people' && <i className={`swatch swatch-${s}`} />}
                        {t.brush[s]}
                      </span>
                    )}
                    <i className="row-check" />
                  </button>
                  <button
                    className="row-more"
                    aria-expanded={open === c.a2}
                    onClick={() => setOpen(open === c.a2 ? null : c.a2)}
                    title={t.details.open(name)}
                    aria-label={t.details.open(name)}
                  >
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m6 8 4 4 4-4" />
                    </svg>
                  </button>
                  {open === c.a2 && (
                    <CountryDetails
                      country={c}
                      lang={lang}
                      editable={!viewing}
                      trips={shownExtras.trips[c.a2] ?? NO_TRIPS}
                      regions={shownExtras.regions}
                      onTrips={(list) => setTrips(c.a2, list)}
                      onRegion={toggleRegion}
                      onRegions={setRegions}
                      onShow={() => showOnMap(c.a2)}
                      onError={(text) => setToast({ id: Date.now(), text, color: null })}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </>
  )

  const syncNote = syncFailed && (
    <p className="sync-failed" role="status">
      {t.account.syncFailed}
    </p>
  )

  return (
    <div
      className="app"
      data-style={style}
      data-dark={isDark(style) || undefined}
      data-panel={settings.panel ? 'open' : 'closed'}
      style={sheet.phone ? ({ '--peek': `${sheet.peek}px` } as React.CSSProperties) : undefined}
    >
      <main className="stage">
        <div className="topbar">
          <p className="wordmark">been map</p>
          {pages}
          <div className="tools">
            {modeSwitch}
            {styleSwitch}
          </div>
          {tally}
        </div>

        <div className="zoom">
          <button onClick={() => globe.current?.zoomBy(1.5)} aria-label={t.zoomIn}>
            +
          </button>
          <button onClick={() => globe.current?.zoomBy(1 / 1.5)} aria-label={t.zoomOut}>
            −
          </button>
        </div>

        {viewing?.kind !== 'shared' && (
          <button
            className="layer-toggle"
            aria-pressed={regionLevel}
            onClick={() => setRegionLevel((on) => !on)}
            title={[...REGION_COUNTRIES].map((a2) => flag(a2)).join(' ')}
          >
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 4.5h6v5H3zM11 4.5h6v7h-6zM3 11.5h6v4H3zM11 13.5h6v2h-6z" />
            </svg>
            <span>{t.regions.toggle}</span>
          </button>
        )}

        <button
          className="panel-toggle"
          aria-expanded={settings.panel}
          aria-label={settings.panel ? t.panelHide : t.panelShow}
          title={settings.panel ? t.panelHide : t.panelShow}
          onClick={() => setSettings((s) => ({ ...s, panel: !s.panel }))}
        >
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m8 5 5 5-5 5" />
          </svg>
        </button>

        {toast && (
          <p className="toast" key={toast.id} role="status">
            {toast.color && <i className="swatch" style={{ background: toast.color }} />}
            {toast.text}
          </p>
        )}

        <Globe
          ref={globe}
          statuses={shown.statuses}
          people={shown.people}
          pins={shownExtras.pins}
          regions={shownExtras.regions}
          regionLevel={regionLevel}
          compare={comparing ? statuses : null}
          mode={mode}
          style={style}
          lang={lang}
          onPick={pick}
        />

        {viewing && (
          <div className="viewing" data-above-brush={!readOnly || undefined}>
            <span>
              {viewing.kind === 'friend' ? (
                <strong>{t.account.viewing(viewing.username)}</strong>
              ) : (
                <>
                  <strong>{t.account.sharedTitle(viewing.name)}</strong> · {t.account.people(viewing.members)}
                </>
              )}
            </span>
            {viewing.kind === 'friend' && comparing && (
              <span className="legend">
                <i className="swatch" style={ink(COMPARE.me)} /> {t.compare.me} {compareCounts.me}
                <i className="swatch" style={ink(COMPARE.them)} /> {t.compare.them(viewing.username)} {compareCounts.them}
                <i className="swatch" style={ink(COMPARE.both)} /> {t.compare.both} {compareCounts.both}
              </span>
            )}
            {viewing.kind === 'friend' && Object.values(statuses).some(isBeen) && (
              <button className="ghost" aria-pressed={compare} onClick={() => setCompare((on) => !on)}>
                {t.compare.toggle}
              </button>
            )}
            <button onClick={stopViewing}>{t.account.back}</button>
          </div>
        )}
        {brushBar(true)}
      </main>

      <aside
        className="panel"
        ref={sheet.sheet}
        data-snap={sheet.phone ? sheet.snap : undefined}
        style={
          sheet.phone
            ? ({
                // until it has been measured the sheet waits below the screen, then slides up
                transform: sheet.peek ? `translateY(${sheet.offset}px)` : 'translateY(100%)',
                '--sheet-offset': `${sheet.offset}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <header className="panel-title on-desktop">{title}</header>
        <section className="continents on-desktop" aria-label={t.progress}>
          {progress}
        </section>

        <div className="sheet-head" ref={sheet.head}>
          <button className="grip" aria-label={t.sheet} {...sheet.grip} />
          {syncNote}
          {finder}
        </div>
        <i className="safe-area" ref={sheet.safeArea} />

        <div className="list">
          <header className="panel-title on-phone">{title}</header>
          <section className="continents on-phone" aria-label={t.progress}>
            {progress}
          </section>
          {page === 'map' && rows}
        </div>
      </aside>

      {page === 'hub' && (
        <div className="hub">
          <header className="hub-bar">
            <p className="wordmark">been map</p>
            {pages}
          </header>
          {badges && (
            <AchievementsPage
              lang={lang}
              input={{ statuses: shown.statuses, people: shown.people, stats, extras: shownExtras }}
              onBack={() => setBadges(false)}
            />
          )}
          <div className="hub-grid" hidden={badges}>
            <div className="hub-column">
              <section className="card">
                <header className="panel-title">{title}</header>
                {tally}
                <div className="continents" aria-label={t.progress}>
                  {progress}
                </div>
              </section>
              <Achievements
                lang={lang}
                input={{ statuses: shown.statuses, people: shown.people, stats, extras: shownExtras }}
                onOpen={() => setBadges(true)}
              />
              {viewing?.kind !== 'shared' && (
                <Places lang={lang} pins={shownExtras.pins} editable={!viewing} onShow={showPin} onRemove={togglePin} />
              )}
              {viewing?.kind !== 'shared' && <RegionProgress lang={lang} extras={shownExtras} onOpen={openDetails} />}
              {!viewing && <Timeline lang={lang} extras={extras} onOpen={openDetails} />}
              <section className="card options">
                <h2 className="card-title">{t.options}</h2>
                <div className="option">
                  <span>{t.viewLabel}</span>
                  {modeSwitch}
                </div>
                <div className="option">
                  <span>{t.styleLabel}</span>
                  {styleSwitch}
                </div>
                <div className="option">
                  <span>{t.language}</span>
                  <div className="switch" role="radiogroup" aria-label={t.language}>
                    {LANGS.map((l) => (
                      <button
                        key={l}
                        role="radio"
                        aria-checked={lang === l}
                        onClick={() => setSettings((s) => ({ ...s, lang: l }))}
                      >
                        {l === 'pl' ? 'Polski' : 'English'}
                      </button>
                    ))}
                  </div>
                </div>
                <button className="primary" onClick={() => setSharing(true)}>
                  <DownloadIcon /> {t.share.open}
                </button>
              </section>
            </div>

            <section className="card countries">
              <h2 className="card-title">{t.countriesTitle}</h2>
              {brushBar(false)}
              {syncNote}
              {finder}
              <div className="list">{rows}</div>
            </section>

            <section className="card">
              <Account lang={lang} account={account} onViewFriend={viewFriend} onOpenShared={openShared} />
            </section>
          </div>
        </div>
      )}

      {sharing && <Share lang={lang} render={renderShare} onClose={closeShare} />}
    </div>
  )
}
