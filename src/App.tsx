import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Globe, { type GlobeHandle } from './Globe'
import { LANGS, STRINGS, countryName, type Brush } from './i18n'
import {
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
  loadPeople,
  loadSettings,
  loadStatuses,
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

type Snap = 'peek' | 'half' | 'full'
const PHONE = '(max-width: 860px)'

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

const ink = (color: string) => ({ '--status': color }) as React.CSSProperties

export default function App() {
  const [statuses, setStatuses] = useState<Statuses>(loadStatuses)
  const [people, setPeople] = useState(loadPeople)
  const [settings, setSettings] = useState(loadSettings)
  const [brush, setBrush] = useState<Brush>('visited')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const globe = useRef<GlobeHandle>(null)
  const sheet = useSheet()

  const { lang, mode } = settings
  const t = STRINGS[lang]

  // The map's click handler needs the latest values without re-subscribing.
  const live = useRef({ statuses, people, brush })
  live.current = { statuses, people, brush }

  useEffect(() => saveStatuses(statuses), [statuses])
  useEffect(() => savePeople(people), [people])
  useEffect(() => {
    saveSettings(settings)
    document.documentElement.lang = settings.lang
    document.title = STRINGS[settings.lang].title
  }, [settings])

  /**
   * Applies the active marking to a country; a second tap with the same marking clears it.
   * Returns the marking's colour, or null when it was cleared.
   */
  const toggle = useCallback((a2: string) => {
    const { statuses: current, people: known, brush: active } = live.current
    if (active === 'people') {
      const next = new Set(known)
      const added = !next.delete(a2)
      if (added) next.add(a2)
      live.current.people = next
      setPeople(next)
      return added ? PEOPLE_COLOR : null
    }
    const next = { ...current }
    const added = current[a2] !== active
    if (added) next[a2] = active
    else delete next[a2]
    live.current.statuses = next
    setStatuses(next)
    return added ? STATUS_BY_ID[active].color : null
  }, [])

  const showOnMap = (a2: string) => {
    globe.current?.flyTo(a2)
    // on a phone the sheet would otherwise cover the country
    sheet.setSnap('peek')
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
  }

  const stats = useMemo(() => computeStats(statuses, people), [statuses, people])

  const sorted = useMemo(
    () => [...COUNTRIES].sort((a, b) => countryName(a, lang).localeCompare(countryName(b, lang), lang)),
    [lang],
  )

  const groups = useMemo(() => {
    const q = fold(query.trim())
    const rows = sorted.filter((c) => {
      const s = statuses[c.a2]
      if (filter === 'marked' && !s && !people.has(c.a2)) return false
      if (filter === 'wish' && s !== 'wish') return false
      return !q || fold(c.name).includes(q) || fold(c.en).includes(q)
    })
    return CONTINENT_IDS.map((id) => ({ id, rows: rows.filter((c) => c.cont === id) })).filter((g) => g.rows.length)
  }, [query, filter, statuses, people, sorted])

  const empty = Object.keys(statuses).length === 0 && people.size === 0
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
        <header className="masthead">
          <p className="wordmark">been map</p>
          <p className="tally">
            <span className="tally-number">{stats.been}</span>
            <span className="tally-text">
              <strong>{t.countriesOf(stats.been, stats.total)}</strong>
              <span>{t.landShare(landShareLabel(stats.landShare))}</span>
            </span>
          </p>
          {empty && <p className="hint">{t.hint}</p>}
        </header>

        <Globe ref={globe} statuses={statuses} people={people} mode={mode} lang={lang} onPick={toggle} />

        <div className="brush" role="radiogroup" aria-label={t.brushLabel}>
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
            >
              {t.download}
            </button>
          </div>
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
                  {g.rows.filter((c) => isBeen(statuses[c.a2])).length}/{g.rows.length}
                </span>
              </h2>
              <ul>
                {g.rows.map((c) => {
                  const s = statuses[c.a2]
                  const knows = people.has(c.a2)
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
    </div>
  )
}
