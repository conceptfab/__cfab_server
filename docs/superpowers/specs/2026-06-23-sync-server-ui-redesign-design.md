# TimeFlow Sync Server UI Redesign

## Status

Zatwierdzone 23 czerwca 2026 na podstawie makiety `overview-console-v1`.

## Cel

Zmienić obecną długą stronę administracyjną w techniczną konsolę operacyjną synchronizacji. Pierwsze spojrzenie ma odpowiadać na trzy pytania: czy serwer działa, czy storage działa oraz co wydarzyło się podczas ostatnich synchronizacji.

## Użytkownik i priorytet

- Użytkownik: administrator techniczny TimeFlow.
- Główne zadanie: wykrycie problemu z synchronizacją i przejście do miejsca, w którym można go usunąć.
- Drugorzędne zadanie: zarządzanie urządzeniami, licencjami, grupami i backendami storage.
- Ton: techniczny, oszczędny i precyzyjny; Vercel jest benchmarkiem jakości hierarchii, nie wzorem do kopiowania.

## Architektura informacji

Panel pozostaje pod istniejącym, chronionym adresem `/`. Widok wybiera parametr `view`, dzięki czemu nie zmieniamy routingu uwierzytelnienia ani API:

- `/?view=overview` — stan systemu, alerty, aktywność i postęp konfiguracji;
- `/?view=activity` — pełna historia Direct Sync;
- `/?view=devices` — urządzenia i ich stan online;
- `/?view=licenses` — licencje i operacje administracyjne;
- `/?view=groups` — grupy klientów i przypisania;
- `/?view=storage` — backendy storage, test połączenia i konfiguracja.

Nieznana wartość `view` wraca do `overview`. Stan logowania i obsługa błędu odczytu danych pozostają na `/`.

## Zatwierdzony układ

### Shell

- Stały lewy rail o szerokości około 228 px z nazwą produktu, środowiskiem, sześcioma widokami i kontem administratora.
- Górny pasek zawiera breadcrumbs, wyszukiwanie zasobów i skrót `⌘K`/`Ctrl+K`.
- Na ekranach poniżej 900 px rail zwęża się do ikon; poniżej 640 px staje się wysuwanym menu.

### Overview

1. Nagłówek z nazwą widoku i akcją „Sprawdź stan”.
2. Pas statusu: stan całego systemu, API, storage i uptime.
3. Jeden dominujący alert, jeśli komponent jest niedostępny; alert prowadzi do właściwego widoku.
4. Główna powierzchnia robocza:
   - ostatnia aktywność synchronizacji;
   - checklista konfiguracji dla pustego środowiska.
5. Zwarty pasek liczników: urządzenia, licencje, grupy i storage.

### Widoki zasobów

- Każdy zasób dostaje własny ekran i jedną główną tabelę.
- Tworzenie i edycja odbywa się w drawerze otwieranym z prawej strony; formularze nie zajmują stale miejsca nad tabelą.
- Destrukcyjne akcje pozostają wizualnie drugorzędne i wymagają potwierdzenia.
- Puste stany wyjaśniają następny krok zamiast wyświetlać wyłącznie „Brak danych”.

## System wizualny

- Tło: niemal czarne, neutralne; bez gradientów i ozdobnych tekstur.
- Powierzchnie są rozdzielane liniami 1 px, nie cieniami i nie zestawem pływających kart.
- Promienie: 6 px dla kontrolek, 8 px dla głównych powierzchni.
- Typografia: Geist lub systemowy fallback; monospace wyłącznie dla identyfikatorów, kluczy i rewizji.
- Akcenty statusowe: zielony = działa, czerwony = błąd, bursztynowy = uwaga. Kolor nie służy dekoracji.
- Kontrolki: 34–40 px na desktopie, minimum 44 px na telefonie.
- Ruch: tylko opacity/transform, maksymalnie 150 ms dla stanów kontrolek; pełne wsparcie `prefers-reduced-motion`.

## Zachowanie i stany

- Każda akcja ma: default, hover, focus-visible, active, disabled, loading, error i success.
- Sukces formularza jest pokazywany lokalnie, bez celebracyjnych toastów.
- Błąd storage jest widoczny na Overview i w widoku Storage.
- `⌘K`/`Ctrl+K` otwiera lokalną paletę nawigacji po sześciu widokach; Escape zamyka i zwraca fokus.
- Tabele na wąskich ekranach zmieniają się w listę rekordów; nie wymagają poziomego przewijania całej strony.

## Granice zmian

Redesign nie zmienia kontraktów API, logiki synchronizacji, autoryzacji, storage, licencji ani modelu danych. Nie usuwa istniejących route'ów i nie zastępuje działających operacji CRUD. Refaktoryzacja `src/app/page.tsx` służy wyłącznie rozdzieleniu odpowiedzialności UI.

## Kryteria akceptacji

- Po zalogowaniu domyślnie otwiera się Overview.
- Niedostępny storage jest widoczny bez przewijania.
- Administrator dociera do każdego zasobu jednym kliknięciem z raila.
- Formularze nie są stale rozwinięte w tabelach zasobów.
- Widoki 320, 375, 414, 768 i 1280 px nie mają poziomego scrolla strony.
- Fokus klawiatury jest zawsze widoczny, a paleta poleceń działa bez myszy.
- `npm run lint`, `npm test` i `npm run build` przechodzą.

