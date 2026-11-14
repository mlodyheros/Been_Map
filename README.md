# Been Map

Mapa odwiedzonych krajów na interaktywnym globusie. Dane zapisują się lokalnie w przeglądarce.

```bash
npm install
npm run dev
```

- `npm run build` — sprawdzenie typów i build produkcyjny
- `npm run countries` — odświeża `src/data/countries.json` z pakietu `world-countries`
- `npm run cities` — odświeża `public/cities.json` (miejscowości od 5 tys. mieszkańców, w Polsce od 1 tys., oraz wszystkie stolice) z pakietu `all-the-cities`
- `npm run regions -- ścieżka/ne_10m_admin_1_states_provinces.geojson` — odświeża `public/regions.json` (stany, prowincje, województwa) z warstwy „admin 1” Natural Earth

## Konta i znajomi

Logowanie, synchronizacja mapy, znajomi i wspólne mapy działają na Supabase. Jednorazowa konfiguracja projektu:

1. SQL Editor → wklej i uruchom `supabase/schema.sql` (można uruchamiać ponownie po każdej zmianie pliku).
2. Authentication → URL Configuration → ustaw Site URL na adres aplikacji i dodaj `http://localhost:5173` do Redirect URLs.

Adres projektu i klucz publiczny są w `src/cloud.ts`.

### Logowanie przez Google i Apple

Przyciski pojawiają się same, gdy dostawca jest włączony w Supabase (Authentication → Sign In / Providers):

- **Google** — w Google Cloud Console utwórz „OAuth client ID” typu Web application, jako Authorized redirect URI podaj adres „Callback URL” pokazany w Supabase, a Client ID i Client Secret wklej w Supabase.
- **Apple** — wymaga płatnego konta Apple Developer: Services ID z „Sign in with Apple”, ten sam Callback URL, a w Supabase Services ID i wygenerowany klucz.

Po pierwszym logowaniu takim kontem aplikacja prosi o wybranie nazwy użytkownika.

### Publiczny link

W Panelu → Konto można włączyć „Publiczny link”. Adres `…/?u=nazwa` pokazuje mapę tylko do podglądu, bez logowania. Notatki nie są udostępniane.
