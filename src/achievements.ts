import type { Extras } from './extras'
import type { Lang } from './i18n'
import { COUNTRIES, isBeen, type Stats, type Statuses } from './model'

export interface Achievement {
  id: string
  icon: string
  name: Record<Lang, string>
  /** What it takes, in a few words. */
  hint: Record<Lang, string>
  /** How far along, as [done, needed]. */
  progress(input: Input): [number, number]
}

interface Input {
  statuses: Statuses
  stats: Stats
  extras: Extras
}

const countries = (n: number, icon: string, pl: string, en: string): Achievement => ({
  id: `countries-${n}`,
  icon,
  name: { pl, en },
  hint: { pl: `Odwiedź ${n} ${n === 1 ? 'kraj' : n < 5 ? 'kraje' : 'krajów'}`, en: `Visit ${n} ${n === 1 ? 'country' : 'countries'}` },
  progress: ({ stats }) => [stats.been, n],
})

const group = (id: string, icon: string, codes: string[], pl: string, en: string, hintPl: string, hintEn: string): Achievement => ({
  id,
  icon,
  name: { pl, en },
  hint: { pl: hintPl, en: hintEn },
  progress: ({ statuses }) => [codes.filter((a2) => isBeen(statuses[a2])).length, codes.length],
})

const continents = (n: number, icon: string, pl: string, en: string): Achievement => ({
  id: `continents-${n}`,
  icon,
  name: { pl, en },
  hint: { pl: `Postaw stopę na ${n} kontynentach`, en: `Set foot on ${n} continents` },
  progress: ({ stats }) => [stats.continents.filter((c) => c.been > 0).length, n],
})

const land = (pct: number, icon: string, pl: string, en: string): Achievement => ({
  id: `land-${pct}`,
  icon,
  name: { pl, en },
  hint: { pl: `Odwiedź kraje zajmujące ${pct}% lądów`, en: `Visit countries covering ${pct}% of the land` },
  progress: ({ stats }) => [Math.min(pct, Math.floor(stats.landShare * 100)), pct],
})

const SOUTH = new Set(COUNTRIES.filter((c) => c.lat < 0).map((c) => c.a2))
const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']

export const ACHIEVEMENTS: Achievement[] = [
  countries(1, '👣', 'Pierwszy krok', 'First step'),
  countries(5, '🎒', 'Plecak spakowany', 'Bag packed'),
  countries(10, '🧭', 'Podróżnik', 'Traveller'),
  countries(25, '✈️', 'Obieżyświat', 'Globetrotter'),
  countries(50, '🌍', 'Pół setki', 'Half a hundred'),
  countries(100, '🏆', 'Klub stu', 'Century club'),
  continents(3, '🗺️', 'Trzy kontynenty', 'Three continents'),
  continents(5, '🌐', 'Pięć kontynentów', 'Five continents'),
  continents(6, '👑', 'Wszystkie kontynenty', 'Every continent'),
  land(10, '📏', '10% świata', '10% of the world'),
  land(25, '🪐', 'Ćwierć świata', 'A quarter of the world'),
  {
    id: 'hemispheres',
    icon: '🧊',
    name: { pl: 'Obie półkule', en: 'Both hemispheres' },
    hint: { pl: 'Odwiedź kraj po każdej stronie równika', en: 'Visit a country on each side of the equator' },
    progress: ({ statuses }) => {
      const been = Object.keys(statuses).filter((a2) => isBeen(statuses[a2]))
      return [Number(been.some((a2) => !SOUTH.has(a2))) + Number(been.some((a2) => SOUTH.has(a2))), 2]
    },
  },
  group('scandinavia', '🦌', ['DK', 'NO', 'SE'], 'Cała Skandynawia', 'All of Scandinavia', 'Dania, Norwegia i Szwecja', 'Denmark, Norway and Sweden'),
  group('nordics', '❄️', ['DK', 'NO', 'SE', 'FI', 'IS'], 'Kraje nordyckie', 'The Nordics', 'Skandynawia, Finlandia i Islandia', 'Scandinavia, Finland and Iceland'),
  group('baltics', '🌊', ['EE', 'LV', 'LT'], 'Kraje bałtyckie', 'The Baltics', 'Estonia, Łotwa i Litwa', 'Estonia, Latvia and Lithuania'),
  group('visegrad', '🏰', ['PL', 'CZ', 'SK', 'HU'], 'Grupa Wyszehradzka', 'Visegrád Four', 'Polska, Czechy, Słowacja i Węgry', 'Poland, Czechia, Slovakia and Hungary'),
  group('benelux', '🚲', ['BE', 'NL', 'LU'], 'Beneluks', 'Benelux', 'Belgia, Holandia i Luksemburg', 'Belgium, the Netherlands and Luxembourg'),
  group('iberia', '☀️', ['ES', 'PT'], 'Półwysep Iberyjski', 'Iberia', 'Hiszpania i Portugalia', 'Spain and Portugal'),
  group('isles', '☔', ['GB', 'IE'], 'Wyspy Brytyjskie', 'The British Isles', 'Wielka Brytania i Irlandia', 'The United Kingdom and Ireland'),
  group('eu', '🇪🇺', EU, 'Cała Unia', 'The whole EU', 'Wszystkie 27 krajów Unii Europejskiej', 'All 27 countries of the European Union'),
  group('g7', '🏛️', ['US', 'CA', 'GB', 'FR', 'DE', 'IT', 'JP'], 'Wielka siódemka', 'The G7', 'USA, Kanada, Wielka Brytania, Francja, Niemcy, Włochy i Japonia', 'USA, Canada, UK, France, Germany, Italy and Japan'),
  {
    id: 'places-10',
    icon: '📍',
    name: { pl: 'Dziesięć miejsc', en: 'Ten places' },
    hint: { pl: 'Zaznacz 10 miast lub miejsc', en: 'Mark 10 cities or places' },
    progress: ({ extras }) => [extras.pins.length, 10],
  },
  {
    id: 'regions-10',
    icon: '🧩',
    name: { pl: 'Kawałek po kawałku', en: 'Piece by piece' },
    hint: { pl: 'Zaznacz 10 regionów (stanów, województw…)', en: 'Mark 10 regions (states, provinces…)' },
    progress: ({ extras }) => [Object.values(extras.regions).filter(isBeen).length, 10],
  },
]

export const unlocked = (input: Input) =>
  ACHIEVEMENTS.filter((a) => {
    const [done, needed] = a.progress(input)
    return done >= needed
  }).map((a) => a.id)
