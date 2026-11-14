import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MAX_NOTE, MAX_PHOTOS, MAX_TRIPS, TRANSPORTS, newTripId, tripIsEmpty, type Transport, type Trip } from './extras'
import { STRINGS, type Lang } from './i18n'
import { STATUS_BY_ID, isBeen, type Country, type Statuses } from './model'
import { addPhoto, photoUrl, removePhotos, usePhoto } from './photos'
import { REGION_COUNTRIES, regionName, useRegions } from './regions'

export const TRANSPORT_ICON: Record<Transport, string> = {
  plane: '✈️',
  car: '🚗',
  train: '🚆',
  bus: '🚌',
  ship: '⛴️',
  bike: '🚲',
  moto: '🏍️',
  foot: '🥾',
}

interface Props {
  country: Country
  lang: Lang
  /** False on someone else's map: everything is shown, nothing can be changed. */
  editable: boolean
  trips: readonly Trip[]
  regions: Statuses
  onTrips(trips: Trip[]): void
  onRegion(id: string): void
  /** Marks every listed region, or clears them all. */
  onRegions(ids: string[], on: boolean): void
  onShow(): void
  onError(text: string): void
}

function Thumb({ id, label, onOpen }: { id: string; label: string; onOpen(): void }) {
  const url = usePhoto(id)
  if (url === null) return null
  return (
    <button className="photo" onClick={onOpen} aria-label={label} disabled={!url}>
      {url && <img src={url} alt="" loading="lazy" />}
    </button>
  )
}

/** One picture shown large, with the others of its trip a step away. */
function Viewer({
  ids,
  at,
  lang,
  onMove,
  onRemove,
  onClose,
}: {
  ids: readonly string[]
  at: number
  lang: Lang
  onMove(to: number): void
  onRemove: (() => void) | null
  onClose(): void
}) {
  const t = STRINGS[lang].details
  const url = usePhoto(ids[at])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && at > 0) onMove(at - 1)
      if (e.key === 'ArrowRight' && at < ids.length - 1) onMove(at + 1)
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [at, ids.length, onClose, onMove])

  // rendered at the top of the page: the list it belongs to is clipped and, on phones, slides
  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" onClick={onClose}>
      {url && <img src={url} alt="" onClick={(e) => e.stopPropagation()} />}
      <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onMove(at - 1)} disabled={at === 0} aria-label="←">
          ‹
        </button>
        <span>
          {at + 1}/{ids.length}
        </span>
        <button onClick={() => onMove(at + 1)} disabled={at >= ids.length - 1} aria-label="→">
          ›
        </button>
        {onRemove && <button onClick={onRemove}>{t.removePhoto}</button>}
        <button onClick={onClose}>{t.close}</button>
      </div>
    </div>,
    document.body,
  )
}

function TripCard({
  trip,
  index,
  lang,
  editable,
  removable,
  onChange,
  onRemove,
  onError,
}: {
  trip: Trip
  index: number
  lang: Lang
  editable: boolean
  removable: boolean
  onChange(trip: Trip): void
  onRemove(): void
  onError(text: string): void
}) {
  const t = STRINGS[lang].details
  const [viewing, setViewing] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  // the newest version of the trip, for photos that finish loading after other edits
  const latest = useRef(trip)
  latest.current = trip
  const photos = trip.photos ?? []
  const kinds = trip.transport ?? []

  // photos added on another phone or computer are listed in the trip but are not here
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set())
  const photoKey = photos.join(' ')
  useEffect(() => {
    let current = true
    const ids = photoKey ? photoKey.split(' ') : []
    Promise.all(ids.map(photoUrl)).then((urls) => current && setGone(new Set(ids.filter((_, i) => urls[i] === null))))
    return () => {
      current = false
    }
  }, [photoKey])
  const here = photos.filter((id) => !gone.has(id))
  const missing = photos.length - here.length

  const add = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    let failed = false
    for (const file of [...files]) {
      if ((latest.current.photos?.length ?? 0) >= MAX_PHOTOS) break
      try {
        const id = await addPhoto(file)
        const next = { ...latest.current, photos: [...(latest.current.photos ?? []), id] }
        latest.current = next
        onChange(next)
      } catch {
        failed = true
      }
    }
    setBusy(false)
    if (picker.current) picker.current.value = ''
    if (failed) onError(t.photoFailed)
  }

  const removePhoto = (at: number) => {
    const id = here[at]
    const rest = photos.filter((p) => p !== id)
    onChange({ ...trip, photos: rest.length ? rest : undefined })
    void removePhotos([id])
    setViewing(here.length > 1 ? Math.min(at, here.length - 2) : null)
  }

  return (
    <div className="trip">
      <div className="trip-head">
        <strong>{t.trip(index + 1)}</strong>
        {editable && removable && (
          <button className="trip-remove" onClick={onRemove} aria-label={t.removeTrip} title={t.removeTrip}>
            ×
          </button>
        )}
      </div>
      <div className="details-fields">
        <label>
          {t.when}
          <input
            type="month"
            value={trip.date ?? ''}
            max="2100-12"
            disabled={!editable}
            onChange={(e) => onChange({ ...trip, date: e.target.value || undefined })}
          />
        </label>
        <label>
          {t.note}
          <textarea
            value={trip.text ?? ''}
            rows={2}
            maxLength={MAX_NOTE}
            placeholder={editable ? t.notePlaceholder : ''}
            disabled={!editable}
            onChange={(e) => onChange({ ...trip, text: e.target.value || undefined })}
          />
        </label>
      </div>

      {(editable || kinds.length > 0) && (
        <div className="trip-row" role="group" aria-label={t.transport}>
          <span className="trip-label">{t.transport}</span>
          <div className="transport">
            {TRANSPORTS.filter((k) => editable || kinds.includes(k)).map((k) => (
              <button
                key={k}
                aria-pressed={kinds.includes(k)}
                disabled={!editable}
                title={t.transports[k]}
                onClick={() => {
                  const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : TRANSPORTS.filter((x) => x === k || kinds.includes(x))
                  onChange({ ...trip, transport: next.length ? next : undefined })
                }}
              >
                <span aria-hidden="true">{TRANSPORT_ICON[k]}</span>
                {t.transports[k]}
              </button>
            ))}
          </div>
        </div>
      )}

      {(editable || photos.length > 0) && (
        <div className="trip-row">
          <span className="trip-label">{t.photos(photos.length, MAX_PHOTOS)}</span>
          <div className="photos">
            {here.map((id, i) => (
              <Thumb key={id} id={id} label={`${t.photos(i + 1, here.length)}`} onOpen={() => setViewing(i)} />
            ))}
            {editable && photos.length < MAX_PHOTOS && (
              <button className="photo photo-add" onClick={() => picker.current?.click()} disabled={busy} aria-label={t.addPhoto} title={t.addPhoto}>
                {busy ? '…' : '+'}
              </button>
            )}
            <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => void add(e.target.files)} />
          </div>
          {missing > 0 && (
            <small className="trip-missing">
              {t.photoMissing(missing)}
              {editable && (
                <button onClick={() => onChange({ ...trip, photos: here.length ? here : undefined })}>{t.forgetPhotos}</button>
              )}
            </small>
          )}
        </div>
      )}
      {viewing !== null && here[viewing] && (
        <Viewer
          ids={here}
          at={viewing}
          lang={lang}
          onMove={setViewing}
          onRemove={editable ? () => removePhoto(viewing) : null}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  )
}

/** What opens under a country in the list: its trips (when, how, notes, photos) and its regions. */
export default function CountryDetails({ country, lang, editable, trips, regions, onTrips, onRegion, onRegions, onShow, onError }: Props) {
  const t = STRINGS[lang]
  const hasRegions = REGION_COUNTRIES.has(country.a2)
  const data = useRegions(hasRegions)
  const list = hasRegions
    ? [...(data?.byCountry.get(country.a2) ?? [])].sort((a, b) =>
        regionName(a, lang).localeCompare(regionName(b, lang), lang),
      )
    : []
  const marked = list.filter((r) => isBeen(regions[r.id])).length

  // What is on screen: the stored trips plus any blank one still being filled
  // in. Blank trips are not stored, so they live here until they have content.
  const [shown, setShown] = useState<Trip[]>(() => (trips.length ? [...trips] : editable ? [{ id: newTripId() }] : []))
  const stored = JSON.stringify(trips)
  const sent = useRef(stored)
  useEffect(() => {
    // the map was replaced from outside (signing in): show what it holds now
    if (stored === sent.current) return
    sent.current = stored
    setShown(trips.length ? [...trips] : editable ? [{ id: newTripId() }] : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored])

  // read through a ref: photos finish loading after other edits have been made
  const now = useRef(shown)
  now.current = shown
  const commit = (next: Trip[]) => {
    now.current = next
    setShown(next)
    const kept = next.filter((trip) => !tripIsEmpty(trip))
    sent.current = JSON.stringify(kept)
    onTrips(kept)
  }

  return (
    <div className="details">
      <button className="chip" onClick={onShow}>
        {t.showOnMap}
      </button>

      {shown.length > 0 && (
        <div className="trips">
          {shown.map((trip, i) => (
            <TripCard
              key={trip.id}
              trip={trip}
              index={i}
              lang={lang}
              editable={editable}
              removable={shown.length > 1 || !tripIsEmpty(trip)}
              onChange={(next) => commit(now.current.map((x) => (x.id === trip.id ? next : x)))}
              onRemove={() => {
                void removePhotos(trip.photos ?? [])
                const rest = now.current.filter((x) => x.id !== trip.id)
                commit(rest.length ? rest : [{ id: newTripId() }])
              }}
              onError={onError}
            />
          ))}
          {editable && (
            <div className="trips-foot">
              {shown.length < MAX_TRIPS && !shown.some(tripIsEmpty) && (
                <button className="chip" onClick={() => setShown([...shown, { id: newTripId() }])}>
                  {t.details.addTrip}
                </button>
              )}
              {shown.some((trip) => trip.photos?.length) && <small>{t.details.photosHere}</small>}
            </div>
          )}
        </div>
      )}

      {hasRegions && (
        <div className="details-regions">
          <h3>
            {t.regions.title}
            {data && list.length > 0 && <span>{t.details.regionsDone(marked, list.length)}</span>}
          </h3>
          {data && list.length > 0 && (
            <span className="bar">
              <span style={{ width: `${(marked / list.length) * 100}%` }} />
            </span>
          )}
          {!data && <p>{t.regions.loading}</p>}
          {editable && list.length > 0 && (
            <div className="region-tools">
              {list.some((r) => !regions[r.id]) && (
                <button className="chip" onClick={() => onRegions(list.map((r) => r.id), true)}>
                  {t.regions.all}
                </button>
              )}
              {list.some((r) => regions[r.id]) && (
                <button className="chip" onClick={() => onRegions(list.map((r) => r.id), false)}>
                  {t.regions.none}
                </button>
              )}
            </div>
          )}
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
