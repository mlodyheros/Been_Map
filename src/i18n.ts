import type { CloudErrorCode } from './cloud'
import type { ContinentId, Country, MapStyle, Status } from './model'

export type Lang = 'pl' | 'en'
export const LANGS: Lang[] = ['pl', 'en']

/** A marking the brush can apply: one of the exclusive statuses, or the independent "people" flag. */
export type Brush = Status | 'people'

interface Strings {
  title: string
  myMap: string
  localOnly: string
  countriesOf(n: number, total: number): string
  countries(n: number): string
  landShare(pct: string): string
  brushLabel: string
  brush: Record<Brush, string>
  continents: Record<ContinentId, string>
  pages: { map: string; hub: string }
  panelShow: string
  panelHide: string
  options: string
  countriesTitle: string
  styleLabel: string
  styles: Record<MapStyle, string>
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
  account: {
    open: string
    title: string
    logIn: string
    signUp: string
    email: string
    password: string
    username: string
    usernameHelp: string
    submitLogIn: string
    submitSignUp: string
    working: string
    confirmEmail(email: string): string
    pitch: string
    signedInAs: string
    logOut: string
    close: string
    friends: string
    addPlaceholder: string
    add: string
    sent(name: string): string
    incoming: string
    outgoing: string
    accept: string
    decline: string
    cancel: string
    remove: string
    viewMap: string
    noFriends: string
    viewing(name: string): string
    common(n: number): string
    back: string
    syncFailed: string
    shared: string
    sharedHelp: string
    sharedName: string
    create: string
    openMap: string
    addFriend: string
    leave: string
    delete: string
    noShared: string
    sharedTitle(name: string): string
    people(n: number): string
    marked(country: string, what: string): string
    cleared(country: string): string
    errors: Record<CloudErrorCode, string>
  }
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
  myMap: 'Moja mapa',
  localOnly: 'Zapisana na tym urządzeniu',
  countriesOf: (n, total) => `${plCountries(n)} z ${total}`,
  countries: plCountries,
  landShare: (pct) => `${pct} lądów świata`,
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
  pages: { map: 'Mapa', hub: 'Panel' },
  panelShow: 'Pokaż listę krajów',
  panelHide: 'Schowaj listę krajów',
  options: 'Opcje',
  countriesTitle: 'Kraje',
  styleLabel: 'Wygląd mapy',
  styles: { plain: 'Jasna', terrain: 'Teren', night: 'Noc' },
  viewLabel: 'Widok',
  globe: 'Globus',
  map: 'Płaska',
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
  account: {
    open: 'Zaloguj się',
    title: 'Konto',
    logIn: 'Logowanie',
    signUp: 'Nowe konto',
    email: 'E-mail',
    password: 'Hasło',
    username: 'Nazwa użytkownika',
    usernameHelp: '3–20 znaków: małe litery, cyfry i podkreślnik. Po niej znajdą Cię znajomi.',
    submitLogIn: 'Zaloguj się',
    submitSignUp: 'Załóż konto',
    working: 'Chwila…',
    confirmEmail: (email) => `Wysłaliśmy link na ${email}. Kliknij go, żeby dokończyć zakładanie konta.`,
    pitch: 'Z kontem Twoja mapa jest ta sama na każdym urządzeniu i możesz porównywać ją ze znajomymi.',
    signedInAs: 'Zalogowano jako',
    logOut: 'Wyloguj się',
    close: 'Zamknij',
    friends: 'Znajomi',
    addPlaceholder: 'Nazwa użytkownika znajomego',
    add: 'Wyślij zaproszenie',
    sent: (name) => `Zaproszenie wysłane do @${name}.`,
    incoming: 'Zaproszenia do Ciebie',
    outgoing: 'Wysłane zaproszenia',
    accept: 'Przyjmij',
    decline: 'Odrzuć',
    cancel: 'Anuluj',
    remove: 'Usuń',
    viewMap: 'Pokaż mapę',
    noFriends: 'Nie masz jeszcze znajomych. Wyślij zaproszenie, wpisując czyjąś nazwę użytkownika.',
    viewing: (name) => `Mapa @${name}`,
    common: (n) => `wspólne kraje: ${n}`,
    back: 'Wróć do mojej mapy',
    syncFailed: 'Nie udało się zapisać mapy na koncie. Zmiany są na razie tylko na tym urządzeniu.',
    shared: 'Wspólne mapy',
    sharedHelp: 'Jedna mapa, którą zaznaczacie razem, np. z partnerem albo ekipą z wyjazdów.',
    sharedName: 'Nazwa nowej mapy',
    create: 'Utwórz',
    openMap: 'Otwórz',
    addFriend: 'Dodaj znajomego…',
    leave: 'Opuść',
    delete: 'Usuń',
    noShared: 'Nie masz jeszcze wspólnych map. Utwórz pierwszą i dodaj do niej znajomych.',
    sharedTitle: (name) => `Wspólna mapa: ${name}`,
    people: (n) => `osoby: ${n}`,
    marked: (country, what) => `${country} · ${what}`,
    cleared: (country) => `${country} · usunięto oznaczenie`,
    errors: {
      credentials: 'Nieprawidłowy e-mail lub hasło.',
      emailTaken: 'Konto z tym adresem e-mail już istnieje. Zaloguj się.',
      usernameTaken: 'Ta nazwa użytkownika jest zajęta. Wybierz inną.',
      usernameInvalid: 'Nazwa użytkownika musi mieć 3–20 znaków: małe litery, cyfry lub podkreślnik.',
      passwordShort: 'Hasło jest za krótkie. Użyj co najmniej 6 znaków.',
      unconfirmed: 'Najpierw potwierdź adres e-mail, klikając link z wiadomości.',
      notFound: 'Nie ma użytkownika o takiej nazwie.',
      self: 'To Twoja własna nazwa użytkownika.',
      exists: 'Już jesteście znajomymi albo zaproszenie czeka na odpowiedź.',
      setup: 'Baza danych nie jest jeszcze skonfigurowana. Uruchom supabase/schema.sql w Supabase.',
      unknown: 'Coś poszło nie tak. Spróbuj ponownie.',
    },
  },
}

const en: Strings = {
  title: 'Been Map — Your travel map',
  myMap: 'My map',
  localOnly: 'Saved on this device',
  countriesOf: (n, total) => `${n === 1 ? 'country' : 'countries'} of ${total}`,
  countries: (n) => (n === 1 ? 'country' : 'countries'),
  landShare: (pct) => `${pct} of the world's land`,
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
  pages: { map: 'Map', hub: 'Dashboard' },
  panelShow: 'Show the country list',
  panelHide: 'Hide the country list',
  options: 'Options',
  countriesTitle: 'Countries',
  styleLabel: 'Map style',
  styles: { plain: 'Light', terrain: 'Terrain', night: 'Night' },
  viewLabel: 'View',
  globe: 'Globe',
  map: 'Flat',
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
  account: {
    open: 'Log in',
    title: 'Account',
    logIn: 'Log in',
    signUp: 'New account',
    email: 'Email',
    password: 'Password',
    username: 'Username',
    usernameHelp: '3–20 characters: lowercase letters, digits and underscore. Friends find you by it.',
    submitLogIn: 'Log in',
    submitSignUp: 'Create account',
    working: 'One moment…',
    confirmEmail: (email) => `We sent a link to ${email}. Click it to finish creating your account.`,
    pitch: 'With an account your map is the same on every device and you can compare it with friends.',
    signedInAs: 'Signed in as',
    logOut: 'Log out',
    close: 'Close',
    friends: 'Friends',
    addPlaceholder: "Friend's username",
    add: 'Send invite',
    sent: (name) => `Invite sent to @${name}.`,
    incoming: 'Invites for you',
    outgoing: 'Invites you sent',
    accept: 'Accept',
    decline: 'Decline',
    cancel: 'Cancel',
    remove: 'Remove',
    viewMap: 'Show map',
    noFriends: "You have no friends here yet. Send an invite by typing someone's username.",
    viewing: (name) => `@${name}'s map`,
    common: (n) => `countries in common: ${n}`,
    back: 'Back to my map',
    syncFailed: "Couldn't save your map to your account. Changes are on this device only for now.",
    shared: 'Shared maps',
    sharedHelp: 'One map you mark together, for example with a partner or your travel crew.',
    sharedName: 'Name of the new map',
    create: 'Create',
    openMap: 'Open',
    addFriend: 'Add a friend…',
    leave: 'Leave',
    delete: 'Delete',
    noShared: 'No shared maps yet. Create one and add friends to it.',
    sharedTitle: (name) => `Shared map: ${name}`,
    people: (n) => `people: ${n}`,
    marked: (country, what) => `${country} · ${what}`,
    cleared: (country) => `${country} · marking cleared`,
    errors: {
      credentials: 'Wrong email or password.',
      emailTaken: 'An account with this email already exists. Log in instead.',
      usernameTaken: 'That username is taken. Choose another.',
      usernameInvalid: 'A username needs 3–20 characters: lowercase letters, digits or underscore.',
      passwordShort: 'That password is too short. Use at least 6 characters.',
      unconfirmed: 'Confirm your email first by clicking the link we sent.',
      notFound: 'No user has that username.',
      self: "That's your own username.",
      exists: "You're already friends, or an invite is waiting for an answer.",
      setup: 'The database is not set up yet. Run supabase/schema.sql in Supabase.',
      unknown: 'Something went wrong. Try again.',
    },
  },
}

export const STRINGS: Record<Lang, Strings> = { pl, en }

export const countryName = (c: Country, lang: Lang) => (lang === 'pl' ? c.name : c.en)
