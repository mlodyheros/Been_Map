import type { Note } from './extras'
import { MAX_NOTE } from './extras'
import { STRINGS, type Lang } from './i18n'
import { STATUS_BY_ID, type Country, type Statuses } from './model'
import { REGION_COUNTRIES, regionName, useRegions } from './regions'

interface Props {
  country: Country
  lang: Lang
  /** False on someone else's map: everything is shown, nothing can be changed. */
  editable: boolean
  note: Note | undefined
  regions: Statuses
  onNote(note: Note): void
  onRegion(id: string): void
  onShow(): void
}

/** What opens under a country in the list: when you were there, a note, and its regions. */
export default function CountryDetails({ country, lang, editable, note, regions, onNote, onRegion, onShow }: Props) {
  const t = STRINGS[lang]
  const hasRegions = REGION_COUNTRIES.has(country.a2)
  const data = useRegions(hasRegions)
  const list = hasRegions
    ? [...(data?.byCountry.get(country.a2) ?? [])].sort((a, b) =>
        regionName(a, lang).localeCompare(regionName(b, lang), lang),
      )
    : []
  const marked = list.filter((r) => regions[r.id]).length

  return (
    <div className="details">
      <button className="chip" onClick={onShow}>
        {t.showOnMap}
      </button>

      {(editable || note?.date || note?.text) && (
        <div className="details-fields">
          <label>
            {t.details.when}
            <input
              type="month"
              value={note?.date ?? ''}
              max="2100-12"
              disabled={!editable}
              onChange={(e) => onNote({ ...note, date: e.target.value || undefined })}
            />
          </label>
          <label>
            {t.details.note}
            <textarea
              value={note?.text ?? ''}
              rows={2}
              maxLength={MAX_NOTE}
              placeholder={editable ? t.details.notePlaceholder : ''}
              disabled={!editable}
              onChange={(e) => onNote({ ...note, text: e.target.value || undefined })}
            />
          </label>
        </div>
      )}

      {hasRegions && (
        <div className="details-regions">
          <h3>
            {t.regions.title}
            {data && (
              <span>
                {marked}/{list.length}
              </span>
            )}
          </h3>
          {!data && <p>{t.regions.loading}</p>}
          <div className="region-chips">
            {list.map((r) => {
              const status = regions[r.id]
              return (
                <button
                  key={r.id}
                  className="region-chip"
                  data-on={status || undefined}
                  style={status ? ({ '--status': STATUS_BY_ID[status].color } as React.CSSProperties) : undefined}
                  disabled={!editable}
                  onClick={() => onRegion(r.id)}
                >
                  {regionName(r, lang)}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
