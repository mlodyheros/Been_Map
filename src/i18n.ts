import type { ContinentId, Country, Status } from './model'

export type Lang = 'pl' | 'en'
export const LANGS: Lang[] = ['pl', 'en']

/** A marking the brush can apply: one of the exclusive statuses, or the independent "people" flag. */
export type Brush = Status | 'people'

interface Strings {
  title: string
  countriesOf(n: number, total: number): string
  countries(n: number): string
  landShare(pct: string): string
  hint: string
  brushLabel: string
  brush: Record<Brush, string>
  continents: Record<ContinentId, string>
  viewLabel: string
  globe: string
  map: string
  language: string
  zoomIn: string
  zoomOut: string
  download: string
  progress: string
  extras: { territories: string; transit: string; wish: string; people: string }
  search: string
  filters: { all: string; marked: string; wish: string }
  noMatch(q: string): string
  emptyWish: string
  emptyMarked: string
  showOnMap: string
  mark(what: string, country: string): string
  unmark(country: string): string
  peopleBadge: string
  canvasLabel: string
  sheet: string
}

function plCountries(n: number) {
  const d = n % 10
  const h = n % 100
  if (n === 1) return 'kraj'
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return 'kraje'
  return 'krajów'
}

const pl: Strings = {
  title: 'Been Map — Twoja mapa podróży',
  countriesOf: (n, total) => `${plCountries(n)} z ${total}`,
  countries: plCountries,
  landShare: (pct) => `${pct} lądów świata`,
  hint: 'Kliknij kraj na mapie, żeby go zaznaczyć.',
  brushLabel: 'Zaznaczam jako',
  brush: {
    visited: 'Odwiedzone',
    lived: 'Mieszkałem',
    transit: 'Przejazdem',
    wish: 'Chcę odwiedzić',
    people: 'Znam ludzi stąd',
  },
  continents: {
    EU: 'Europa',
    AS: 'Azja',
    AF: 'Afryka',
    NA: 'Ameryka Północna',
    SA: 'Ameryka Południowa',
    OC: 'Oceania',
    AN: 'Antarktyda',
  },
  viewLabel: 'Widok',
  globe: 'Globus',
  map: 'Mapa',
  language: 'Język',
  zoomIn: 'Przybliż',
  zoomOut: 'Oddal',
  download: 'Pobierz mapę',
  progress: 'Postęp na kontynentach',
  extras: {
    territories: 'Terytoria zależne',
    transit: 'Przejazdem',
    wish: 'Do odwiedzenia',
    people: 'Znam ludzi z',
  },
  search: 'Szukaj kraju',
  filters: { all: 'Wszystkie', marked: 'Zaznaczone', wish: 'Do odwiedzenia' },
  noMatch: (q) => `Brak kraju pasującego do „${q}”.`,
  emptyWish: 'Lista jest pusta. Wybierz „Chcę odwiedzić” pod mapą i zaznacz kraje, o których marzysz.',
  emptyMarked: 'Nic jeszcze nie zaznaczono. Kliknij kraj na mapie albo wróć do zakładki „Wszystkie”.',
  showOnMap: 'Pokaż na mapie',
  mark: (what, country) => `Zaznacz jako ${what}: ${country}`,
  unmark: (country) => `Usuń oznaczenie: ${country}`,
  peopleBadge: 'Znam ludzi stąd',
  canvasLabel: 'Mapa świata z zaznaczonymi krajami. Kraje można też zaznaczać na liście obok.',
  sheet: 'Rozwiń lub zwiń listę krajów',
}

const en: Strings = {
  title: 'Been Map — Your travel map',
  countriesOf: (n, total) => `${n === 1 ? 'country' : 'countries'} of ${total}`,
  countries: (n) => (n === 1 ? 'country' : 'countries'),
  landShare: (pct) => `${pct} of the world's land`,
  hint: 'Click a country on the map to mark it.',
  brushLabel: 'Mark as',
  brush: {
    visited: 'Visited',
    lived: 'Lived here',
    transit: 'Passed through',
    wish: 'Want to visit',
    people: 'Know people from',
  },
  continents: {
    EU: 'Europe',
    AS: 'Asia',
    AF: 'Africa',
    NA: 'North America',
    SA: 'South America',
    OC: 'Oceania',
    AN: 'Antarctica',
  },
  viewLabel: 'View',
  globe: 'Globe',
  map: 'Map',
  language: 'Language',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  download: 'Download map',
  progress: 'Progress by continent',
  extras: {
    territories: 'Territories',
    transit: 'Passed through',
    wish: 'Want to visit',
    people: 'Know people from',
  },
  search: 'Search countries',
  filters: { all: 'All', marked: 'Marked', wish: 'Want to visit' },
  noMatch: (q) => `No country matches “${q}”.`,
  emptyWish: 'Nothing here yet. Choose “Want to visit” below the map and mark the countries you dream of.',
  emptyMarked: 'Nothing marked yet. Click a country on the map, or go back to “All”.',
  showOnMap: 'Show on map',
  mark: (what, country) => `Mark as ${what}: ${country}`,
  unmark: (country) => `Clear marking: ${country}`,
  peopleBadge: 'Know people from here',
  canvasLabel: 'World map with marked countries. Countries can also be marked in the list.',
  sheet: 'Expand or collapse the country list',
}

export const STRINGS: Record<Lang, Strings> = { pl, en }

export const countryName = (c: Country, lang: Lang) => (lang === 'pl' ? c.name : c.en)
