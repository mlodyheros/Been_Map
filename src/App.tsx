import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Account from './Account'
import {
  fetchMap,
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
import Globe, { type GlobeHandle } from './Globe'
import { LANGS, STRINGS, countryName, type Brush } from './i18n'
import {
  BY_A2,
  CONTINENT_IDS,
  COUNTRIES,
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
  type Statuses,
} from './model'
import { downloadPoster } from './share'

type Filter = 'all' | 'marked' | 'wish'
const FILTERS: Filter[] = ['all', 'marked', 'wish']

const BRUSHES: { id: Brush; color: string }[] = [...STATUSES, { id: 'people', color: PEOPLE_COLOR }]
const BRUSH_COLOR = Object.fromEntries(BRUSHES.map((b) => [b.id, b.color])) as Record<Brush, string>
const MODES: MapMode[] = ['globe', 'flat']

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
      e.currentTarget.setPointerCapture(e.pointerId)
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

const UserIcon = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <circle cx="10" cy="7" r="3.2" />
    <path d="M3.8 16.5c.9-2.7 3.3-4.2 6.2-4.2s5.3 1.5 6.2 4.2" />
  </svg>
)

const ink = (color: string) => ({ '--status': color }) as React.CSSProperties

export default function App() {
  const [statuses, setStatuses] = useState<Statuses>(loadStatuses)
  const [people, setPeople] = useState(loadPeople)
  const [settings, setSettings] = useState(loadSettings)
  const [brush, setBrush] = useState<Brush>('visited')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const [syncFailed, setSyncFailed] = useState(false)
  /** A map shown in place of your own: a friend's (read-only) or a shared one (everyone marks it). */
  const [viewing, setViewing] = useState<Viewing | null>(null)
  const [toast, setToast] = useState<{ id: number; text: string; color: string | null } | null>(null)
  const globe = useRef<GlobeHandle>(null)
  const sheet = useSheet()

  const { lang, mode } = settings
  const t = STRINGS[lang]

  // The map's click handler needs the latest values without re-subscribing.
  const live = useRef({ statuses, people, brush, viewing, lang })
  live.current = { statuses, people, brush, viewing, lang }
  /** True once the signed-in account's map has been loaded, so local edits may be uploaded. */
  const cloudReady = useRef(false)

  useEffect(() => saveStatuses(statuses), [statuses])
  useEffect(() => savePeople(people), [people])
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
          ? current?.id === user.id
            ? current
            : { id: user.id, username: String(user.user_metadata.username ?? '') }
          : null,
      )
      if (event === 'SIGNED_OUT') {
        // the map belongs to the account; don't leave it behind for the next person
        cloudReady.current = false
        saveOwner(null)
        setStatuses({})
        setPeople(new Set())
        setViewing(null)
        setSyncFailed(false)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const accountId = account?.id
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
        let next: CloudMap
        if (owner === accountId) next = remote ?? local // local copy is just this account's cache
        else if (owner) next = remote ?? empty // cache left over from another account
        else if (!remote) next = local // first sign-in: the anonymous map becomes the account's map
        else {
          // anonymous marks made before signing in are added to the account's map
          next = {
            statuses: { ...local.statuses, ...remote.statuses },
            people: new Set([...local.people, ...remote.people]),
          }
        }
        live.current.statuses = next.statuses
        live.current.people = next.people
        setStatuses(next.statuses)
        setPeople(next.people)
        saveOwner(accountId)
        cloudReady.current = true
        // the account doesn't hold this exact map yet: store it now rather than on the next edit
        if (next !== remote) await saveMap(accountId, next)
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
      saveMap(accountId, { statuses, people }).then(
        () => setSyncFailed(false),
        () => setSyncFailed(true),
      )
    }, 700)
    return () => clearTimeout(timer)
  }, [accountId, statuses, people])

  const viewFriend = useCallback(async (friend: Friend) => {
    const map = await fetchMap(friend.userId)
    setViewing({ kind: 'friend', username: friend.username, statuses: map?.statuses ?? {}, people: map?.people ?? new Set() })
    setAccountOpen(false)
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
    setAccountOpen(false)
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

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(timer)
  }, [toast])
  const closeAccount = useCallback(() => setAccountOpen(false), [])

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
      else delete marks[a2]
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

  const showOnMap = (a2: string) => {
    globe.current?.flyTo(a2)
    // on a phone the sheet would otherwise cover the country
    sheet.setSnap('peek')
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
  }

  // everything below draws either your own map or the friend's map being viewed
  const own = { statuses, people }
  const shown = viewing ?? own
  const stats = useMemo(() => computeStats(shown.statuses, shown.people), [shown.statuses, shown.people])
  const readOnly = viewing?.kind === 'friend'
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
      if (filter === 'marked' && !s && !shown.people.has(c.a2)) return false
      if (filter === 'wish' && s !== 'wish') return false
      return !q || fold(c.name).includes(q) || fold(c.en).includes(q)
    })
    return CONTINENT_IDS.map((id) => ({ id, rows: rows.filter((c) => c.cont === id) })).filter((g) => g.rows.length)
  }, [query, filter, shown.statuses, shown.people, sorted])

  const empty = !viewing && Object.keys(statuses).length === 0 && people.size === 0 && !toast
  const extras = [
    [t.extras.territories, stats.territories],
    [t.extras.transit, stats.transit],
    [t.extras.wish, stats.wish],
    [t.extras.people, stats.people],
  ] as const

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
        {extras
          .filter(([, n]) => n > 0)
          .map(([label, n]) => `${label}: ${n}`)
          .join(' · ')}
      </p>
    </>
  )

  return (
    <div className="app" style={sheet.phone ? ({ '--peek': `${sheet.peek}px` } as React.CSSProperties) : undefined}>
      <main className="stage">
        <div className="topbar">
        <header className="masthead">
          <p className="wordmark">been map</p>
          <p className="tally">
            <span className="tally-number" key={stats.been}>
              {stats.been}
            </span>
            <span className="tally-text">
              <strong>{t.countriesOf(stats.been, stats.total)}</strong>
              <span>{t.landShare(landShareLabel(stats.landShare))}</span>
            </span>
          </p>
          {empty && <p className="hint">{t.hint}</p>}
        </header>
        <div className="tools">
          <div className="tools-row">
            <div className="switch" role="radiogroup" aria-label={t.viewLabel}>
              {MODES.map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setSettings((s) => ({ ...s, mode: m }))}
                >
                  {m === 'globe' ? t.globe : t.map}
                </button>
              ))}
            </div>
            <div className="switch" role="radiogroup" aria-label={t.language}>
              {LANGS.map((l) => (
                <button
                  key={l}
                  role="radio"
                  aria-checked={lang === l}
                  lang={l}
                  onClick={() => setSettings((s) => ({ ...s, lang: l }))}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="tools-row">
            <button className="tool tool-zoom" onClick={() => globe.current?.zoomBy(1.5)} aria-label={t.zoomIn}>
              +
            </button>
            <button className="tool tool-zoom" onClick={() => globe.current?.zoomBy(1 / 1.5)} aria-label={t.zoomOut}>
              −
            </button>
            <button
              className="tool tool-wide"
              onClick={() => globe.current && downloadPoster(globe.current.snapshot(1600), stats, lang)}
              aria-label={t.download}
            >
              <DownloadIcon />
              <span>{t.download}</span>
            </button>
            <button className="tool tool-wide tool-account" onClick={() => setAccountOpen(true)}>
              {account ? <b className="avatar">{account.username.slice(0, 1).toUpperCase()}</b> : <UserIcon />}
              <span>{account ? `@${account.username}` : t.account.open}</span>
            </button>
          </div>
        </div>
        </div>

        {toast && (
          <p className="toast" key={toast.id} role="status">
            {toast.color && <i className="swatch" style={{ background: toast.color }} />}
            {toast.text}
          </p>
        )}

        <Globe ref={globe} statuses={shown.statuses} people={shown.people} mode={mode} lang={lang} onPick={toggle} />

        {viewing && (
          <div className="viewing" data-above-brush={!readOnly || undefined}>
            <span>
              {viewing.kind === 'friend' ? (
                <>
                  <strong>{t.account.viewing(viewing.username)}</strong> · {t.account.common(common)}
                </>
              ) : (
                <>
                  <strong>{t.account.sharedTitle(viewing.name)}</strong> · {t.account.people(viewing.members)}
                </>
              )}
            </span>
            <button onClick={() => setViewing(null)}>{t.account.back}</button>
          </div>
        )}
        <div className="brush" role="radiogroup" aria-label={t.brushLabel} hidden={readOnly}>
          <span className="brush-label">{t.brushLabel}</span>
          {BRUSHES.map((b) => (
            <button
              key={b.id}
              role="radio"
              aria-checked={brush === b.id}
              className="brush-option"
              style={ink(b.color)}
              onClick={() => setBrush(b.id)}
            >
              <i className={`swatch swatch-${b.id}`} />
              {t.brush[b.id]}
            </button>
          ))}
        </div>

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
        <section className="continents on-desktop" aria-label={t.progress}>
          {progress}
        </section>

        <div className="sheet-head" ref={sheet.head}>
          <button className="grip" aria-label={t.sheet} {...sheet.grip} />
        {syncFailed && (
          <p className="sync-failed" role="status">
            {t.account.syncFailed}
          </p>
        )}
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
                {t.filters[f]}
              </button>
            ))}
          </div>
        </div>
        </div>
        <i className="safe-area" ref={sheet.safeArea} />

        <div className="list">
          <section className="continents on-phone" aria-label={t.progress}>
            {progress}
          </section>
          {groups.length === 0 && (
            <p className="list-empty">
              {query ? t.noMatch(query) : filter === 'wish' ? t.emptyWish : t.emptyMarked}
            </p>
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
                    <li key={c.a2}>
                      <button className="row-name" onClick={() => showOnMap(c.a2)} title={t.showOnMap}>
                        <span className="row-flag">{flag(c.a2)}</span>
                        <span className="row-label">{name}</span>
                        {knows && <i className="swatch swatch-people" style={ink(PEOPLE_COLOR)} title={t.peopleBadge} />}
                      </button>
                      <button
                        className="row-mark"
                        data-on={on || undefined}
                        data-layer={brush === 'people' ? 'people' : s}
                        style={ink(brush === 'people' || !s ? BRUSH_COLOR[brush] : STATUS_BY_ID[s].color)}
                        onClick={() => toggle(c.a2)}
                        disabled={readOnly}
                        title={applied ? t.unmark(name) : t.mark(t.brush[brush], name)}
                        aria-label={applied ? t.unmark(name) : t.mark(t.brush[brush], name)}
                      >
                        {s && (
                          <span className="row-status" style={ink(STATUS_BY_ID[s].color)}>
                            {brush === 'people' && <i className={`swatch swatch-${s}`} />}
                            {t.brush[s]}
                          </span>
                        )}
                        <i />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </aside>

      {accountOpen && (
        <Account
          lang={lang}
          account={account}
          onClose={closeAccount}
          onViewFriend={viewFriend}
          onOpenShared={openShared}
        />
      )}
    </div>
  )
}
