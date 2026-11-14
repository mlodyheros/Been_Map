import { useEffect, useRef } from 'react'
import { ACHIEVEMENTS, CATEGORIES, type Achievement, type Input } from './achievements'
import { TRANSPORT_ICON } from './CountryDetails'
import { allTrips, type Extras, type Pin } from './extras'
import { STRINGS, countryName, type Lang } from './i18n'
import { BY_A2, flag, isBeen } from './model'
import { REGION_COUNTS } from './regions'

interface Row {
  a: Achievement
  done: number
  needed: number
  earned: boolean
}

const rowsOf = (input: Input): Row[] =>
  ACHIEVEMENTS.map((a) => {
    const [done, needed] = a.progress(input)
    return { a, done: Math.min(done, needed), needed, earned: done >= needed }
  })

function Badge({ row, lang }: { row: Row; lang: Lang }) {
  const { a, done, needed, earned } = row
  return (
    <li data-earned={earned || undefined} title={a.hint[lang]}>
      <span className="badge-icon">{a.icon}</span>
      <span className="badge-text">
        <strong>{a.name[lang]}</strong>
        <small>{a.hint[lang]}</small>
        <span className="bar">
          <span style={{ width: `${(done / needed) * 100}%` }} />
        </span>
      </span>
      <span className="badge-count">{earned ? '✓' : `${done}/${needed}`}</span>
    </li>
  )
}

/** A ring filled as far as the share, with the percentage inside. */
function Ring({ share }: { share: number }) {
  const r = 26
  const around = 2 * Math.PI * r
  return (
    <svg className="ring" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label={`${Math.round(share * 100)}%`}>
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="ring-track" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        className="ring-fill"
        strokeDasharray={`${around * share} ${around}`}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="33" textAnchor="middle" dominantBaseline="middle">
        {Math.round(share * 100)}%
      </text>
    </svg>
  )
}

/** The dashboard card: how many are earned, and the ones closest to being earned. */
export function Achievements({ lang, input, onOpen }: { lang: Lang; input: Input; onOpen(): void }) {
  const t = STRINGS[lang].achievements
  const rows = rowsOf(input)
  const earned = rows.filter((r) => r.earned)
  const next = rows
    .filter((r) => !r.earned)
    .sort((x, y) => y.done / y.needed - x.done / x.needed)
    .slice(0, 3)

  return (
    <section className="card">
      <h2 className="card-title">{t.title}</h2>
      <button className="badge-summary" onClick={onOpen}>
        <Ring share={earned.length / rows.length} />
        <span>
          <strong>{t.count(earned.length, rows.length)}</strong>
          <small>{earned.slice(-8).map((r) => r.a.icon).join(' ') || t.next}</small>
        </span>
        <em>{t.all} ›</em>
      </button>
      {next.length > 0 && (
        <>
          <h3 className="badge-heading">{t.next}</h3>
          <ul className="badges">
            {next.map((row) => (
              <Badge key={row.a.id} row={row} lang={lang} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/** Every achievement, by category, with how far along each one is. */
export function AchievementsPage({ lang, input, onBack }: { lang: Lang; input: Input; onBack(): void }) {
  const t = STRINGS[lang].achievements
  const rows = rowsOf(input)
  const earned = rows.filter((r) => r.earned).length
  // the whole way, counting half-finished ones for what they are worth
  const progress = rows.reduce((sum, r) => sum + r.done / r.needed, 0) / rows.length
  // on a phone the dashboard was scrolled down to the card that led here
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // (braces matter: newer browsers return a promise from scrollTo, and an effect must not return one)
    top.current?.closest('.hub')?.scrollTo(0, 0)
  }, [])

  return (
    <div className="badge-page" ref={top}>
      <button className="chip" onClick={onBack}>
        ‹ {t.back}
      </button>
      <section className="card badge-hero">
        <Ring share={earned / rows.length} />
        <div>
          <h2 className="card-title">{t.title}</h2>
          <p>
            <strong>{t.count(earned, rows.length)}</strong> {t.earned} · {Math.round((earned / rows.length) * 100)}%
          </p>
          <span className="bar" title={`${Math.round(progress * 100)}%`}>
            <span style={{ width: `${progress * 100}%` }} />
          </span>
        </div>
      </section>
      <div className="badge-groups">
        {CATEGORIES.map((category) => {
          const list = rows
            .filter((r) => r.a.category === category)
            .sort((x, y) => Number(y.earned) - Number(x.earned) || y.done / y.needed - x.done / x.needed)
          const got = list.filter((r) => r.earned).length
          return (
            <section className="card" key={category}>
              <h2 className="card-title">
                {t.categories[category]}
                <span>
                  {got}/{list.length} · {Math.round((got / list.length) * 100)}%
                </span>
              </h2>
              <span className="bar">
                <span style={{ width: `${(got / list.length) * 100}%` }} />
              </span>
              <ul className="badges">
                {list.map((row) => (
                  <Badge key={row.a.id} row={row} lang={lang} />
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** Every trip with a date, newest first, grouped by year; undated ones at the end. */
export function Timeline({ lang, extras, onOpen }: { lang: Lang; extras: Extras; onOpen(a2: string): void }) {
  const t = STRINGS[lang].timeline
  const month = new Intl.DateTimeFormat(lang, { month: 'long' })
  const entries = allTrips(extras).filter(({ a2 }) => BY_A2.has(a2))
  const years = [...new Set(entries.map(({ trip }) => trip.date?.slice(0, 4) ?? ''))]

  return (
    <section className="card">
      <h2 className="card-title">
        {t.title}
        {entries.length > 0 && <span>{entries.length}</span>}
      </h2>
      {entries.length === 0 && <p className="card-note">{t.empty}</p>}
      {years.map((year) => (
        <div className="timeline-year" key={year}>
          <h3>{year || t.undated}</h3>
          <ul>
            {entries
              .filter(({ trip }) => (trip.date?.slice(0, 4) ?? '') === year)
              .map(({ a2, trip }) => (
                <li key={trip.id}>
                  <button onClick={() => onOpen(a2)}>
                    <span className="row-flag">{flag(a2)}</span>
                    <span>
                      <strong>{countryName(BY_A2.get(a2)!, lang)}</strong>
                      <small>
                        {[
                          trip.date && month.format(new Date(`${trip.date}-15`)),
                          trip.transport?.map((k) => TRANSPORT_ICON[k]).join(' '),
                          trip.photos?.length && `📷 ${trip.photos.length}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                      {trip.text && <em>{trip.text}</em>}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/** How much of each country is marked region by region; the most complete first. */
export function RegionProgress({ lang, extras, onOpen }: { lang: Lang; extras: Extras; onOpen(a2: string): void }) {
  const t = STRINGS[lang]
  const done = new Map<string, number>()
  for (const [id, status] of Object.entries(extras.regions)) {
    const a2 = id.slice(0, 2)
    if (isBeen(status) && REGION_COUNTS[a2] && BY_A2.has(a2)) done.set(a2, (done.get(a2) ?? 0) + 1)
  }
  const rows = [...done]
    .map(([a2, n]) => ({ a2, n: Math.min(n, REGION_COUNTS[a2]), total: REGION_COUNTS[a2] }))
    .sort((x, y) => y.n / y.total - x.n / x.total || y.n - x.n)

  return (
    <section className="card">
      <h2 className="card-title">
        {t.regions.title}
        {rows.length > 0 && <span>{rows.reduce((sum, r) => sum + r.n, 0)}</span>}
      </h2>
      {rows.length === 0 && <p className="card-note">{t.regions.empty}</p>}
      <ul className="region-rows">
        {rows.map(({ a2, n, total }) => (
          <li key={a2}>
            <button onClick={() => onOpen(a2)}>
              <span className="row-flag">{flag(a2)}</span>
              <strong>{countryName(BY_A2.get(a2)!, lang)}</strong>
              <small>{t.details.regionsDone(n, total)}</small>
              <span className="bar">
                <span style={{ width: `${(n / total) * 100}%` }} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The marked cities and pins. */
export function Places({
  lang,
  pins,
  editable,
  onShow,
  onRemove,
}: {
  lang: Lang
  pins: readonly Pin[]
  editable: boolean
  onShow(pin: Pin): void
  onRemove(pin: Pin): void
}) {
  const t = STRINGS[lang].places
  const sorted = [...pins].sort((a, b) => a.name.localeCompare(b.name, lang))
  return (
    <section className="card">
      <h2 className="card-title">
        {t.title}
        {pins.length > 0 && <span>{pins.length}</span>}
      </h2>
      {pins.length === 0 && <p className="card-note">{t.empty}</p>}
      <ul className="places">
        {sorted.map((pin) => (
          <li key={pin.id}>
            <button className="place-name" onClick={() => onShow(pin)}>
              <span className="row-flag">{pin.cc ? flag(pin.cc) : '📍'}</span>
              {pin.name}
            </button>
            {editable && (
              <button className="place-remove" onClick={() => onRemove(pin)} aria-label={t.remove(pin.name)} title={t.remove(pin.name)}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
