import { allTrips, type Extras } from './extras'
import type { Lang } from './i18n'
import { BY_A2, COUNTRIES, isBeen, type ContinentId, type Stats, type Statuses } from './model'
import { REGION_COUNTS } from './regions'

export const CATEGORIES = ['countries', 'world', 'areas', 'kinds', 'places', 'trips'] as const
export type Category = (typeof CATEGORIES)[number]

export interface Achievement {
  id: string
  category: Category
  icon: string
  name: Record<Lang, string>
  /** What it takes, in a few words. */
  hint: Record<Lang, string>
  /** How far along, as [done, needed]. */
  progress(input: Input): [number, number]
}

export interface Input {
  statuses: Statuses
  people: ReadonlySet<string>
  stats: Stats
  extras: Extras
}

const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many

const countries = (n: number, icon: string, pl: string, en: string): Achievement => ({
  id: `countries-${n}`,
  category: 'countries',
  icon,
  name: { pl, en },
  hint: { pl: `Odwiedź ${n} ${plural(n, 'kraj', 'kraje', 'krajów')}`, en: `Visit ${n} ${n === 1 ? 'country' : 'countries'}` },
  progress: ({ stats }) => [stats.been, n],
})

const group = (id: string, icon: string, codes: string[], pl: string, en: string, hintPl: string, hintEn: string, needed = codes.length): Achievement => ({
  id,
  category: 'areas',
  icon,
  name: { pl, en },
  hint: { pl: hintPl, en: hintEn },
  progress: ({ statuses }) => [codes.filter((a2) => isBeen(statuses[a2])).length, needed],
})

const continents = (n: number, icon: string, pl: string, en: string): Achievement => ({
  id: `continents-${n}`,
  category: 'world',
  icon,
  name: { pl, en },
  hint: { pl: `Postaw stopę na ${n} kontynentach`, en: `Set foot on ${n} continents` },
  progress: ({ stats }) => [stats.continents.filter((c) => c.been > 0).length, n],
})

/** A share of one continent's countries, or a fixed number of them. */
const within = (cont: ContinentId, share: number, icon: string, pl: string, en: string, hintPl: string, hintEn: string): Achievement => ({
  id: `${cont}-${share}`,
  category: 'world',
  icon,
  name: { pl, en },
  hint: { pl: hintPl, en: hintEn },
  progress: ({ stats }) => {
    const c = stats.continents.find((x) => x.id === cont)
    return c ? [c.been, share <= 1 ? Math.ceil(c.total * share) : share] : [0, 1]
  },
})

const land = (pct: number, icon: string, pl: string, en: string): Achievement => ({
  id: `land-${pct}`,
  category: 'world',
  icon,
  name: { pl, en },
  hint: { pl: `Odwiedź kraje zajmujące ${pct}% lądów`, en: `Visit countries covering ${pct}% of the land` },
  progress: ({ stats }) => [Math.min(pct, Math.floor(stats.landShare * 100)), pct],
})

const custom = (
  id: string,
  category: Category,
  icon: string,
  pl: string,
  en: string,
  hintPl: string,
  hintEn: string,
  progress: Achievement['progress'],
): Achievement => ({ id, category, icon, name: { pl, en }, hint: { pl: hintPl, en: hintEn }, progress })

const beenList = (statuses: Statuses) => Object.keys(statuses).filter((a2) => isBeen(statuses[a2]))
const count = (statuses: Statuses, status: string) => Object.values(statuses).filter((s) => s === status).length
const SOUTH = new Set(COUNTRIES.filter((c) => c.lat < 0).map((c) => c.a2))
const WEST = new Set(COUNTRIES.filter((c) => c.lng < -25).map((c) => c.a2))

const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']
const ISLANDS = ['IS', 'IE', 'GB', 'MT', 'CY', 'JP', 'PH', 'ID', 'LK', 'MV', 'MG', 'MU', 'SC', 'CV', 'CU', 'JM', 'DO', 'HT', 'BS', 'BB', 'TT', 'NZ', 'FJ', 'AU', 'SG', 'TW', 'BH']

/** Marked regions of one country against how many it has. */
const regionsOf = (extras: Extras, a2: string): [number, number] => [
  Object.keys(extras.regions).filter((id) => id.startsWith(`${a2}-`) && isBeen(extras.regions[id])).length,
  REGION_COUNTS[a2] ?? 1,
]
const beenRegions = (extras: Extras) => Object.values(extras.regions).filter(isBeen).length
const wholeCountry = (a2: string, icon: string, pl: string, en: string, hintPl: string, hintEn: string) =>
  custom(`regions-${a2}`, 'places', icon, pl, en, hintPl, hintEn, ({ extras }) => regionsOf(extras, a2))

const tripCount = (n: number, icon: string, pl: string, en: string) =>
  custom(`trips-${n}`, 'trips', icon, pl, en, `Opisz ${n} ${plural(n, 'wyprawę', 'wyprawy', 'wypraw')} (data lub notatka)`, `Describe ${n} ${n === 1 ? 'trip' : 'trips'} (a date or a note)`, ({ extras }) => [allTrips(extras).length, n])
const photoCount = (n: number, icon: string, pl: string, en: string) =>
  custom(`photos-${n}`, 'trips', icon, pl, en, `Dodaj ${n} ${plural(n, 'zdjęcie', 'zdjęcia', 'zdjęć')} do wypraw`, `Add ${n} ${n === 1 ? 'photo' : 'photos'} to your trips`, ({ extras }) => [
    allTrips(extras).reduce((sum, { trip }) => sum + (trip.photos?.length ?? 0), 0),
    n,
  ])
const kinds = (extras: Extras) => new Set(allTrips(extras).flatMap(({ trip }) => trip.transport ?? []))

export const ACHIEVEMENTS: Achievement[] = [
  // ---- how many countries
  countries(1, '👣', 'Pierwszy krok', 'First step'),
  countries(5, '🎒', 'Plecak spakowany', 'Bag packed'),
  countries(10, '🧭', 'Podróżnik', 'Traveller'),
  countries(25, '✈️', 'Obieżyświat', 'Globetrotter'),
  countries(50, '🌍', 'Pół setki', 'Half a hundred'),
  countries(75, '🛫', 'Stały bywalec lotnisk', 'Airport regular'),
  countries(100, '🏆', 'Klub stu', 'Century club'),
  countries(150, '🚀', 'Prawie wszędzie', 'Almost everywhere'),
  countries(195, '🌟', 'Cały świat', 'The whole world'),
  custom('territories-3', 'countries', '🏝️', 'Dalekie zakątki', 'Far corners', 'Odwiedź 3 terytoria zależne', 'Visit 3 dependent territories', ({ stats }) => [stats.territories, 3]),
  custom('micro', 'countries', '🔍', 'Małe jest piękne', 'Small is beautiful', 'Odwiedź 3 europejskie mikropaństwa', 'Visit 3 European microstates', ({ statuses }) => [
    ['VA', 'SM', 'MC', 'LI', 'AD', 'MT', 'LU'].filter((a2) => isBeen(statuses[a2])).length,
    3,
  ]),
  custom('giants', 'countries', '🐘', 'Giganci', 'The giants', 'Odwiedź 5 największych krajów świata', 'Visit the five largest countries', ({ statuses }) => [
    ['RU', 'CA', 'US', 'CN', 'BR'].filter((a2) => isBeen(statuses[a2])).length,
    5,
  ]),
  custom('islands', 'countries', '🌴', 'Wyspiarz', 'Island hopper', 'Odwiedź 5 państw wyspiarskich', 'Visit 5 island countries', ({ statuses }) => [
    ISLANDS.filter((a2) => isBeen(statuses[a2])).length,
    5,
  ]),

  // ---- continents and the globe
  continents(2, '🧳', 'Dwa kontynenty', 'Two continents'),
  continents(3, '🗺️', 'Trzy kontynenty', 'Three continents'),
  continents(5, '🌐', 'Pięć kontynentów', 'Five continents'),
  continents(6, '👑', 'Wszystkie kontynenty', 'Every continent'),
  within('EU', 10, '🥐', 'Europa na start', 'Europe for starters', 'Odwiedź 10 krajów Europy', 'Visit 10 countries in Europe'),
  within('EU', 0.5, '🏰', 'Pół Europy', 'Half of Europe', 'Odwiedź połowę krajów Europy', 'Visit half the countries of Europe'),
  within('EU', 1, '🎻', 'Cała Europa', 'All of Europe', 'Odwiedź wszystkie kraje Europy', 'Visit every country in Europe'),
  within('AS', 5, '🏯', 'Smak Azji', 'A taste of Asia', 'Odwiedź 5 krajów Azji', 'Visit 5 countries in Asia'),
  within('AS', 15, '🐉', 'Szlakiem jedwabnym', 'The Silk Road', 'Odwiedź 15 krajów Azji', 'Visit 15 countries in Asia'),
  within('AF', 5, '🦁', 'Safari', 'Safari', 'Odwiedź 5 krajów Afryki', 'Visit 5 countries in Africa'),
  within('AF', 15, '🌅', 'Serce Afryki', 'Heart of Africa', 'Odwiedź 15 krajów Afryki', 'Visit 15 countries in Africa'),
  within('NA', 5, '🗽', 'Nowy Świat', 'The New World', 'Odwiedź 5 krajów Ameryki Północnej', 'Visit 5 countries in North America'),
  within('SA', 5, '🦙', 'Latynoski rytm', 'Latin rhythm', 'Odwiedź 5 krajów Ameryki Południowej', 'Visit 5 countries in South America'),
  within('SA', 1, '💃', 'Cała Ameryka Południowa', 'All of South America', 'Odwiedź wszystkie kraje Ameryki Południowej', 'Visit every country in South America'),
  within('OC', 3, '🐨', 'Antypody', 'Down under', 'Odwiedź 3 kraje Oceanii', 'Visit 3 countries in Oceania'),
  land(10, '📏', '10% świata', '10% of the world'),
  land(25, '🪐', 'Ćwierć świata', 'A quarter of the world'),
  land(50, '🌕', 'Pół świata', 'Half the world'),
  custom('hemispheres', 'world', '🧊', 'Obie półkule', 'Both hemispheres', 'Odwiedź kraj po każdej stronie równika', 'Visit a country on each side of the equator', ({ statuses }) => {
    const been = beenList(statuses)
    return [Number(been.some((a2) => !SOUTH.has(a2))) + Number(been.some((a2) => SOUTH.has(a2))), 2]
  }),
  custom('quarters', 'world', '🧿', 'Cztery strony świata', 'Four corners', 'Odwiedź kraj w każdej ćwiartce globu: północ i południe, wschód i zachód', 'Visit a country in each quarter of the globe: north and south, east and west', ({ statuses }) => {
    const been = beenList(statuses)
    const corner = (south: boolean, west: boolean) => Number(been.some((a2) => SOUTH.has(a2) === south && WEST.has(a2) === west))
    return [corner(false, false) + corner(false, true) + corner(true, false) + corner(true, true), 4]
  }),

  // ---- parts of the world
  group('neighbours', '🤝', ['DE', 'CZ', 'SK', 'UA', 'BY', 'LT', 'RU'], 'Sąsiedzi Polski', 'Poland’s neighbours', 'Niemcy, Czechy, Słowacja, Ukraina, Białoruś, Litwa i Rosja', 'Germany, Czechia, Slovakia, Ukraine, Belarus, Lithuania and Russia'),
  group('visegrad', '🏰', ['PL', 'CZ', 'SK', 'HU'], 'Grupa Wyszehradzka', 'Visegrád Four', 'Polska, Czechy, Słowacja i Węgry', 'Poland, Czechia, Slovakia and Hungary'),
  group('scandinavia', '🦌', ['DK', 'NO', 'SE'], 'Cała Skandynawia', 'All of Scandinavia', 'Dania, Norwegia i Szwecja', 'Denmark, Norway and Sweden'),
  group('nordics', '❄️', ['DK', 'NO', 'SE', 'FI', 'IS'], 'Kraje nordyckie', 'The Nordics', 'Skandynawia, Finlandia i Islandia', 'Scandinavia, Finland and Iceland'),
  group('baltics', '🌊', ['EE', 'LV', 'LT'], 'Kraje bałtyckie', 'The Baltics', 'Estonia, Łotwa i Litwa', 'Estonia, Latvia and Lithuania'),
  group('benelux', '🚲', ['BE', 'NL', 'LU'], 'Beneluks', 'Benelux', 'Belgia, Holandia i Luksemburg', 'Belgium, the Netherlands and Luxembourg'),
  group('iberia', '☀️', ['ES', 'PT'], 'Półwysep Iberyjski', 'Iberia', 'Hiszpania i Portugalia', 'Spain and Portugal'),
  group('isles', '☔', ['GB', 'IE'], 'Wyspy Brytyjskie', 'The British Isles', 'Wielka Brytania i Irlandia', 'The United Kingdom and Ireland'),
  group('alps', '🏔️', ['AT', 'CH', 'FR', 'IT', 'DE', 'SI', 'LI'], 'Kraje alpejskie', 'The Alps', 'Austria, Szwajcaria, Francja, Włochy, Niemcy, Słowenia i Liechtenstein', 'Austria, Switzerland, France, Italy, Germany, Slovenia and Liechtenstein'),
  group('balkans', '🎺', ['SI', 'HR', 'BA', 'RS', 'ME', 'XK', 'MK', 'AL', 'BG', 'GR'], 'Bałkany', 'The Balkans', 'Od Słowenii po Grecję — 10 krajów', 'From Slovenia to Greece — 10 countries'),
  group('mediterranean', '🫒', ['ES', 'FR', 'IT', 'HR', 'GR', 'TR', 'CY', 'MT', 'EG', 'TN', 'MA', 'IL'], 'Morze Śródziemne', 'The Mediterranean', '8 z 12 krajów nad Morzem Śródziemnym', '8 of 12 countries on the Mediterranean', 8),
  group('eu', '🇪🇺', EU, 'Cała Unia', 'The whole EU', 'Wszystkie 27 krajów Unii Europejskiej', 'All 27 countries of the European Union'),
  group('caucasus', '⛰️', ['GE', 'AM', 'AZ'], 'Kaukaz', 'The Caucasus', 'Gruzja, Armenia i Azerbejdżan', 'Georgia, Armenia and Azerbaijan'),
  group('stans', '🐎', ['KZ', 'UZ', 'KG', 'TJ', 'TM'], 'Pięć „stanów”', 'The five Stans', 'Kazachstan, Uzbekistan, Kirgistan, Tadżykistan i Turkmenistan', 'Kazakhstan, Uzbekistan, Kyrgyzstan, Tajikistan and Turkmenistan'),
  group('gulf', '🕌', ['SA', 'AE', 'QA', 'KW', 'BH', 'OM'], 'Zatoka Perska', 'The Gulf', 'Arabia Saudyjska, Emiraty, Katar, Kuwejt, Bahrajn i Oman', 'Saudi Arabia, the Emirates, Qatar, Kuwait, Bahrain and Oman'),
  group('asean', '🍜', ['TH', 'VN', 'KH', 'LA', 'MM', 'MY', 'SG', 'ID', 'PH', 'BN'], 'Azja Południowo-Wschodnia', 'South-East Asia', '6 z 10 krajów ASEAN', '6 of the 10 ASEAN countries', 6),
  group('fareast', '🏮', ['JP', 'KR', 'CN', 'TW'], 'Daleki Wschód', 'The Far East', 'Japonia, Korea Południowa, Chiny i Tajwan', 'Japan, South Korea, China and Taiwan'),
  group('maghreb', '🐪', ['MA', 'DZ', 'TN'], 'Maghreb', 'The Maghreb', 'Maroko, Algieria i Tunezja', 'Morocco, Algeria and Tunisia'),
  group('northamerica', '🦅', ['US', 'CA', 'MX'], 'Wielka trójka', 'The big three', 'USA, Kanada i Meksyk', 'USA, Canada and Mexico'),
  group('centralamerica', '🌋', ['GT', 'BZ', 'SV', 'HN', 'NI', 'CR', 'PA'], 'Ameryka Środkowa', 'Central America', 'Wszystkie 7 krajów przesmyku', 'All 7 countries of the isthmus'),
  group('caribbean', '🥥', ['CU', 'JM', 'HT', 'DO', 'BS', 'BB', 'TT', 'LC', 'GD', 'AG', 'DM', 'KN', 'VC'], 'Karaiby', 'The Caribbean', '4 z 13 wyspiarskich państw Karaibów', '4 of the 13 Caribbean island countries', 4),
  group('andes', '🗻', ['VE', 'CO', 'EC', 'PE', 'BO', 'CL', 'AR'], 'Andy', 'The Andes', '5 z 7 krajów andyjskich', '5 of the 7 Andean countries', 5),
  group('g7', '🏛️', ['US', 'CA', 'GB', 'FR', 'DE', 'IT', 'JP'], 'Wielka siódemka', 'The G7', 'USA, Kanada, Wielka Brytania, Francja, Niemcy, Włochy i Japonia', 'USA, Canada, UK, France, Germany, Italy and Japan'),
  group('brics', '🧱', ['BR', 'RU', 'IN', 'CN', 'ZA'], 'BRICS', 'BRICS', 'Brazylia, Rosja, Indie, Chiny i RPA', 'Brazil, Russia, India, China and South Africa'),

  // ---- the other markings
  custom('lived-1', 'kinds', '🏠', 'Drugi dom', 'Second home', 'Zaznacz kraj, w którym mieszkałeś', 'Mark a country you have lived in', ({ statuses }) => [count(statuses, 'lived'), 1]),
  custom('lived-3', 'kinds', '🏡', 'Obywatel świata', 'Citizen of the world', 'Zaznacz 3 kraje, w których mieszkałeś', 'Mark 3 countries you have lived in', ({ statuses }) => [count(statuses, 'lived'), 3]),
  custom('transit-5', 'kinds', '🚏', 'Tylko przejazdem', 'Just passing through', 'Zaznacz 5 krajów jako „przejazdem”', 'Mark 5 countries as passed through', ({ statuses }) => [count(statuses, 'transit'), 5]),
  custom('wish-10', 'kinds', '💭', 'Lista marzeń', 'Bucket list', 'Dodaj 10 krajów do odwiedzenia', 'Add 10 countries you want to visit', ({ statuses }) => [count(statuses, 'wish'), 10]),
  custom('people-5', 'kinds', '💬', 'Znajomi w świecie', 'Friends abroad', 'Znaj ludzi z 5 krajów', 'Know people from 5 countries', ({ people }) => [people.size, 5]),
  custom('people-15', 'kinds', '🫂', 'Międzynarodowe towarzystwo', 'International crowd', 'Znaj ludzi z 15 krajów', 'Know people from 15 countries', ({ people }) => [people.size, 15]),
  custom('people-30', 'kinds', '🕸️', 'Sieć kontaktów', 'Well connected', 'Znaj ludzi z 30 krajów', 'Know people from 30 countries', ({ people }) => [people.size, 30]),

  // ---- places and regions
  custom('places-1', 'places', '📌', 'Pierwsza pinezka', 'First pin', 'Zaznacz miasto lub miejsce', 'Mark a city or a place', ({ extras }) => [extras.pins.length, 1]),
  custom('places-10', 'places', '📍', 'Dziesięć miejsc', 'Ten places', 'Zaznacz 10 miast lub miejsc', 'Mark 10 cities or places', ({ extras }) => [extras.pins.length, 10]),
  custom('places-25', 'places', '🏙️', 'Mieszczuch', 'City slicker', 'Zaznacz 25 miast lub miejsc', 'Mark 25 cities or places', ({ extras }) => [extras.pins.length, 25]),
  custom('places-50', 'places', '🌆', 'Kolekcjoner miast', 'City collector', 'Zaznacz 50 miast lub miejsc', 'Mark 50 cities or places', ({ extras }) => [extras.pins.length, 50]),
  custom('places-100', 'places', '🌃', 'Sto miejsc', 'A hundred places', 'Zaznacz 100 miast lub miejsc', 'Mark 100 cities or places', ({ extras }) => [extras.pins.length, 100]),
  custom('places-countries', 'places', '🧷', 'Pinezki bez granic', 'Pins without borders', 'Miej pinezki w 10 różnych krajach', 'Have pins in 10 different countries', ({ extras }) => [
    new Set(extras.pins.map((p) => p.cc).filter(Boolean)).size,
    10,
  ]),
  custom('regions-10', 'places', '🧩', 'Kawałek po kawałku', 'Piece by piece', 'Zaznacz 10 regionów (stanów, województw…)', 'Mark 10 regions (states, provinces…)', ({ extras }) => [beenRegions(extras), 10]),
  custom('regions-50', 'places', '🗂️', 'Znawca regionów', 'Regional expert', 'Zaznacz 50 regionów', 'Mark 50 regions', ({ extras }) => [beenRegions(extras), 50]),
  custom('regions-100', 'places', '🧱', 'Sto regionów', 'A hundred regions', 'Zaznacz 100 regionów', 'Mark 100 regions', ({ extras }) => [beenRegions(extras), 100]),
  wholeCountry('PL', '🇵🇱', 'Cała Polska', 'All of Poland', 'Odwiedź wszystkie 16 województw', 'Visit all 16 voivodeships'),
  custom('regions-US-half', 'places', '🛣️', 'Route 66', 'Route 66', 'Odwiedź 25 stanów USA', 'Visit 25 US states', ({ extras }) => [regionsOf(extras, 'US')[0], 25]),
  wholeCountry('US', '🇺🇸', 'Wszystkie stany', 'Every state', 'Odwiedź wszystkie stany USA i Dystrykt Kolumbii', 'Visit every US state and the District of Columbia'),
  wholeCountry('DE', '🇩🇪', 'Wszystkie landy', 'Every Bundesland', 'Odwiedź wszystkie 16 landów Niemiec', 'Visit all 16 German states'),
  wholeCountry('IT', '🇮🇹', 'Od Alp po Sycylię', 'From the Alps to Sicily', 'Odwiedź wszystkie 20 regionów Włoch', 'Visit all 20 regions of Italy'),
  wholeCountry('ES', '🇪🇸', 'Cała Hiszpania', 'All of Spain', 'Odwiedź wszystkie regiony Hiszpanii', 'Visit every region of Spain'),
  custom('regions-complete', 'places', '💯', 'Komplet', 'Full set', 'Odwiedź wszystkie regiony dowolnego kraju', 'Visit every region of any one country', ({ extras }) => {
    // the country that is closest to complete
    let best: [number, number] = [0, 1]
    for (const a2 of new Set(Object.keys(extras.regions).map((id) => id.slice(0, 2)))) {
      const [done, all] = regionsOf(extras, a2)
      if (BY_A2.has(a2) && REGION_COUNTS[a2] && done / all > best[0] / best[1]) best = [Math.min(done, all), all]
    }
    return best
  }),

  // ---- trips: dates, notes, transport, photos
  tripCount(1, '📝', 'Pierwszy wpis', 'First entry'),
  tripCount(5, '📔', 'Dziennik podróży', 'Travel journal'),
  tripCount(15, '📚', 'Kronikarz', 'Chronicler'),
  tripCount(30, '🖋️', 'Reportażysta', 'Travel writer'),
  custom('years-5', 'trips', '📅', 'Pięć sezonów', 'Five seasons', 'Miej wyprawy z 5 różnych lat', 'Have trips from 5 different years', ({ extras }) => [
    new Set(allTrips(extras).map(({ trip }) => trip.date?.slice(0, 4)).filter(Boolean)).size,
    5,
  ]),
  custom('return', 'trips', '🔁', 'Powrót', 'Coming back', 'Opisz dwie wyprawy do tego samego kraju', 'Describe two trips to the same country', ({ extras }) => [
    Math.min(2, Math.max(0, ...Object.values(extras.trips).map((t) => t.length))),
    2,
  ]),
  custom('transport-3', 'trips', '🚆', 'Czym się da', 'By any means', 'Podróżuj 3 różnymi środkami transportu', 'Travel by 3 different kinds of transport', ({ extras }) => [kinds(extras).size, 3]),
  custom('transport-6', 'trips', '🛞', 'Lądem, wodą i powietrzem', 'By land, sea and air', 'Podróżuj 6 różnymi środkami transportu', 'Travel by 6 different kinds of transport', ({ extras }) => [kinds(extras).size, 6]),
  custom('slow', 'trips', '🥾', 'Powoli', 'Slow travel', 'Odbądź wyprawę pieszo lub rowerem', 'Make a trip on foot or by bike', ({ extras }) => [
    Number(kinds(extras).has('foot') || kinds(extras).has('bike')),
    1,
  ]),
  photoCount(1, '📷', 'Pierwsze zdjęcie', 'First photo'),
  photoCount(25, '🖼️', 'Album', 'Photo album'),
  photoCount(100, '🎞️', 'Fotoreporter', 'Photojournalist'),
]

export const unlocked = (input: Input) =>
  ACHIEVEMENTS.filter((a) => {
    const [done, needed] = a.progress(input)
    return done >= needed
  }).map((a) => a.id)
