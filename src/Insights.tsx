import { ACHIEVEMENTS } from './achievements'
import type { Extras, Pin } from './extras'
import { STRINGS, countryName, type Lang } from './i18n'
import { BY_A2, flag, type Stats, type Statuses } from './model'

/** Badges with how far along each one is; earned ones first. */
export function Achievements({ lang, statuses, stats, extras }: { lang: Lang; statuses: Statuses; stats: Stats; extras: Extras }) {
  const t = STRINGS[lang].achievements
  const rows = ACHIEVEMENTS.map((a) => {
    const [done, needed] = a.progress({ statuses, stats, extras })
    return { a, done: Math.min(done, needed), needed, earned: done >= needed }
  }).sort((x, y) => Number(y.earned) - Number(x.earned) || y.done / y.needed - x.done / x.needed)
  const earned = rows.filter((r) => r.earned).length

  return (
    <section className="card">
      <h2 className="card-title">
        {t.title}
        <span>{t.count(earned, rows.length)}</span>
      </h2>
      <ul className="badges">
        {rows.map(({ a, done, needed, earned }) => (
          <li key={a.id} data-earned={earned || undefined} title={a.hint[lang]}>
            <span className="badge-icon">{a.icon}</span>
            <span className="badge-text">
              <strong>{a.name[lang]}</strong>
              <small>{a.hint[lang]}</small>
              <span className="bar">
                <span style={{ width: `${(done / needed) * 100}%` }} />
              </span>
            </span>
            <span className="badge-count">
              {done}/{needed}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Countries with a date, newest first, grouped by year; notes without a date at the end. */
export function Timeline({ lang, extras, onOpen }: { lang: Lang; extras: Extras; onOpen(a2: string): void }) {
  const t = STRINGS[lang].timeline
  const month = new Intl.DateTimeFormat(lang, { month: 'long' })
  const entries = Object.entries(extras.notes)
    .filter(([a2]) => BY_A2.has(a2))
    .sort(([, a], [, b]) => (b.date ?? '').localeCompare(a.date ?? ''))
  const years = [...new Set(entries.map(([, n]) => n.date?.slice(0, 4) ?? ''))]

  return (
    <section className="card">
      <h2 className="card-title">{t.title}</h2>
      {entries.length === 0 && <p className="card-note">{t.empty}</p>}
      {years.map((year) => (
        <div className="timeline-year" key={year}>
          <h3>{year || t.undated}</h3>
          <ul>
            {entries
              .filter(([, n]) => (n.date?.slice(0, 4) ?? '') === year)
              .map(([a2, n]) => (
                <li key={a2}>
                  <button onClick={() => onOpen(a2)}>
                    <span className="row-flag">{flag(a2)}</span>
                    <span>
                      <strong>{countryName(BY_A2.get(a2)!, lang)}</strong>
                      {n.date && <small>{month.format(new Date(`${n.date}-15`))}</small>}
                      {n.text && <em>{n.text}</em>}
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
