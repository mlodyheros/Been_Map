# Been Map

Mapa odwiedzonych krajów na interaktywnym globusie. Dane zapisują się lokalnie w przeglądarce.

```bash
npm install
npm run dev
```

- `npm run build` — sprawdzenie typów i build produkcyjny
- `npm run countries` — odświeża `src/data/countries.json` z pakietu `world-countries`

## Konta i znajomi

Logowanie, synchronizacja mapy, znajomi i wspólne mapy działają na Supabase. Jednorazowa konfiguracja projektu:

1. SQL Editor → wklej i uruchom `supabase/schema.sql` (można uruchamiać ponownie po każdej zmianie pliku).
2. Authentication → URL Configuration → ustaw Site URL na adres aplikacji i dodaj `http://localhost:5173` do Redirect URLs.

Adres projektu i klucz publiczny są w `src/cloud.ts`.
