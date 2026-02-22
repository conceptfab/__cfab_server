# Server Plan (Po Przeniesieniu Folderu Serwera)

## Cel dokumentu

Ten plan opisuje dokladnie, co trzeba zrobic **po stronie serwera** (repo serwera po przeniesieniu), aby przejsc z obecnego MVP (`status/push/pull` + storage plikowy) do wersji gotowej do stabilnego uzycia na Railway.

Dokument jest celowo niezalezny od starej sciezki `__cfab_server`.

## Zakres

W zakresie:

- repo serwera (Next.js API),
- deploy na Railway,
- baza danych i migracje,
- auth/autoryzacja endpointow sync,
- storage snapshotow,
- walidacja i limity,
- monitoring, logi, backupy,
- testy i rollout.

Poza zakresem (osobne zadania):

- UI dashboardu (poza ewentualnymi zmianami kontraktu API),
- finalna decyzja E2E encryption vs web dashboard UX,
- billing/subskrypcje.

## Stan wyjsciowy (na teraz)

MVP juz istnieje i dziala koncepcyjnie:

- `POST /api/sync/status`
- `POST /api/sync/push`
- `POST /api/sync/pull`
- wersjonowanie `revision` + `payloadSha256`
- klient robi startup sync i manualny `Sync now`

Ograniczenia MVP:

- storage plikowy (nieprodukcyjny),
- brak auth (uzywa `userId` z requestu),
- brak rate limit / ochrony przed naduzyciami,
- brak trwalej obserwowalnosci i backupow.

## Kluczowe decyzje do potwierdzenia (przed implementacja produkcyjna)

1. Auth:
   - `API token per user` (najszybsze MVP prod)
   - `email+password + session/JWT` (lepsze dlugofalowo)
2. Storage snapshotu:
   - `JSON w Postgres` (prostsze)
   - `blob/object storage + metadata w Postgres` (lepsza skala)
3. Szyfrowanie:
   - server-side encryption (wygodny web dashboard)
   - E2E (bezpieczniej, ale web dashboard wymaga hasla do odszyfrowania)
4. Retencja:
   - tylko latest snapshot
   - historia snapshotow (N ostatnich / 30 dni)

## Docelowa architektura (rekomendowana)

- Next.js (App Router) jako API serwera sync + ewentualny web dashboard
- Postgres (Railway) jako primary source of truth dla metadata sync
- Opcjonalnie object storage dla duzych snapshotow (na pozniejszym etapie)
- Auth middleware dla endpointow `/api/sync/*`
- Tabela `sync_heads` (aktualny stan usera) + `sync_snapshots` (historia)
- W przyszlosci: `audit events`, `rate limits`, `metrics`

## Struktura repo serwera (docelowa)

Przykladowa struktura do utrzymania porzadku:

```text
<SERVER_REPO_ROOT>/
  src/
    app/
      api/
        sync/
          status/route.ts
          push/route.ts
          pull/route.ts
      (opcjonalnie web dashboard)
    lib/
      auth/
        server-auth.ts
      db/
        client.ts
      sync/
        contracts.ts
        validation.ts
        service.ts
        repository.ts
        hash.ts
        errors.ts
      observability/
        logger.ts
        request-id.ts
  prisma/
    schema.prisma
    migrations/
  scripts/
    backfill/ (opcjonalnie)
  .env.example
  README.md
```

## Plan prac (dokladna checklista)

### Faza 0: Porzadki po przeniesieniu folderu (jednorazowo)

- [ ] Potwierdzic nowa lokalizacje repo serwera i zaktualizowac lokalne skrypty/README
- [ ] Potwierdzic, ze Railway deployuje z poprawnego repo i brancha
- [ ] Potwierdzic, ze root katalogu projektu w Railway wskazuje na repo serwera (nie stare monorepo)
- [ ] Ustawic `NODE_VERSION` zgodny z lokalnym runtime
- [ ] Dodac/uzupelnic `.env.example`
- [ ] Zaktualizowac dokumentacje klienta (jesli zawiera stare sciezki deweloperskie)

### Faza 1: Konfiguracja produkcyjna i sekrety

- [ ] Zdefiniowac komplet zmiennych srodowiskowych:
  - `DATABASE_URL`
  - `SYNC_AUTH_MODE` (`token` / `session`)
  - `SYNC_API_TOKEN_SECRET` (jesli tokeny podpisywane)
  - `SYNC_MAX_PAYLOAD_BYTES`
  - `SYNC_ALLOWED_ORIGINS` (opcjonalnie dla web/dashboard)
  - `LOG_LEVEL`
  - `ENCRYPTION_MODE` (`none` / `server` / `e2e`)
- [ ] Dodac walidacje env przy starcie (`zod`/wlasny validator)
- [ ] Fail-fast gdy brakuje krytycznych sekretow w production
- [ ] Rozdzielic konfiguracje `development` vs `production`

### Faza 2: Baza danych (Postgres) i migracje

Minimalny model danych (rekomendowany):

- [ ] `users`
  - `id`
  - `public_user_id` (to co klient wpisuje / alias) lub `email`
  - pola auth (zalezne od wybranej metody)
  - `created_at`, `updated_at`
- [ ] `devices`
  - `id`
  - `user_id`
  - `device_id` (z klienta)
  - `display_name` (opcjonalnie)
  - `last_seen_at`
  - `last_client_revision`
  - `last_client_hash`
- [ ] `sync_heads` (1 rekord per user)
  - `user_id` (unique)
  - `latest_revision`
  - `latest_snapshot_id`
  - `latest_payload_sha256`
  - `updated_at`
- [ ] `sync_snapshots`
  - `id`
  - `user_id`
  - `revision`
  - `payload_sha256`
  - `source_device_id`
  - `archive_json` (na poczatek `JSONB`) lub referencja do blob storage
  - `size_bytes`
  - `created_at`
  - unique `(user_id, revision)`
  - index `(user_id, payload_sha256)`
- [ ] (Opcjonalnie) `sync_events`
  - request log / audit (status/push/pull)

Technicznie:

- [ ] Wprowadzic Prisma (lub inny ORM/query builder) do repo serwera
- [ ] Stworzyc `prisma/schema.prisma`
- [ ] Wygenerowac pierwsza migracje
- [ ] Uruchomic migracje lokalnie i na Railway
- [ ] Dodac seed/test user (jesli potrzebne do testow)

### Faza 3: Auth i autoryzacja endpointow sync

#### Wariant A (najszybszy): token per user

- [ ] Zdefiniowac format tokenu (np. random secret per user albo signed token)
- [ ] Dodac naglowek auth, np. `Authorization: Bearer <token>`
- [ ] Powiazac token z `user_id` po stronie serwera
- [ ] Zablokowac mozliwosc podawania dowolnego `userId` bez autoryzacji
- [ ] Dla kompatybilnosci MVP: tymczasowy fallback tylko w `development`

#### Wariant B (docelowo): konto + sesja/JWT

- [ ] Endpoint rejestracji/logowania
- [ ] Hashowanie hasel (`argon2`/`bcrypt`)
- [ ] Sesja/JWT + middleware
- [ ] Powiazanie `deviceId` z zalogowanym userem

W kazdym wariancie:

- [ ] Middleware auth dla `/api/sync/*`
- [ ] Jasne kody bledow `401/403`
- [ ] Logowanie prob nieautoryzowanych (bez wycieku sekretow)

### Faza 4: Refaktor logiki sync (z pliku do DB)

- [ ] Wydzielic warstwy:
  - `contracts` (typy API)
  - `validation` (shape + limity)
  - `service` (logika biznesowa)
  - `repository` (DB)
- [ ] Zastapic file-based store implementacja DB
- [ ] Zachowac semantyke MVP:
  - `status` zwraca `shouldPush`/`shouldPull`
  - `push` deduplikuje po hash
  - `pull` zwraca snapshot gdy `serverRevision > clientRevision`
- [ ] Aktualizowac heartbeat urzadzenia przy kazdym requestcie
- [ ] Zabezpieczyc `push` transakcyjnie:
  - odczyt `head`
  - porownanie hash
  - insert snapshot
  - update head
- [ ] Dodac testy na race conditions (2 push jednoczesnie)

### Faza 5: Walidacja danych i limity (bardzo wazne)

- [ ] Walidacja request body (np. `zod`)
- [ ] Walidacja shape `ExportArchive` (minimum wymaganych pol)
- [ ] Limit rozmiaru payloadu:
  - body parser limit
  - walidacja `Content-Length` / real size
- [ ] Limit czestotliwosci requestow (rate limiting)
- [ ] Odrzucanie niepoprawnych typow / zbyt duzych tablic
- [ ] Bezpieczne bledy (bez stack trace w odpowiedzi prod)

### Faza 6: Bezpieczenstwo i hardening HTTP

- [ ] Ustawic `https` only na produkcji (Railway default + forwarding headers)
- [ ] Ograniczyc CORS (jesli potrzebne)
- [ ] Dolozyc security headers (jesli serwer wystawia web UI)
- [ ] Nie logowac tokenow ani pelnych payloadow archiwum
- [ ] Maskowanie PII w logach (jesli pojawi sie email/login)
- [ ] Rate limit per token/user/IP
- [ ] Podstawowa ochrona anty-abuse (burst + sustained)

### Faza 7: Obserwowalnosc (logi / monitoring / alerty)

- [ ] Logger strukturalny (JSON logs)
- [ ] `requestId` per request (header + log context)
- [ ] Logowac:
  - endpoint
  - user/device (zanonimizowane lub ID)
  - latency
  - wynik (`pull`/`push`/`noop`)
  - payload size
- [ ] Healthcheck endpoint (`GET /api/health` lub `/healthz`)
- [ ] Metryki/alerty (minimum):
  - 5xx rate
  - latency p95
  - failed auth attempts
  - DB connection issues

### Faza 8: Backupy i retencja

- [ ] Ustalic retencje snapshotow:
  - np. latest + ostatnie 20
  - albo 30 dni
- [ ] Job cleanup starych snapshotow
- [ ] Backup Postgresa (Railway snapshots/backup policy)
- [ ] Procedura odtworzenia (restore test)

### Faza 9: Testy (server-only)

#### Unit

- [ ] `status` decision matrix:
  - brak danych na serwerze
  - serwer nowszy
  - klient nowszy
  - rowny revision, rozny hash
  - rowny revision, brak hash
- [ ] deduplikacja `push` po hash
- [ ] walidacja `ExportArchive`

#### Integracyjne

- [ ] `status -> push -> status -> pull`
- [ ] dwa urzadzenia tego samego usera
- [ ] nieautoryzowany request -> `401/403`
- [ ] zbyt duzy payload -> `413`

#### Manualne

- [ ] Test lokalny z dashboardem (2 instancje / 2 urzadzenia)
- [ ] Test na Railway (latency + limity)
- [ ] Test rollback/restore po bledzie migracji

### Faza 10: Rollout produkcyjny

- [ ] Wdrozyc serwer z auth w trybie testowym
- [ ] Wlaczyc logowanie klienta do nowego endpointu na 1 urzadzeniu
- [ ] Zweryfikowac logi, latency, deduplikacje i `revision`
- [ ] Stopniowo wlaczyc kolejne urzadzenia
- [ ] Dopiero potem wymagac auth po stronie klienta dla wszystkich

## Kontrakt API (docelowy - do wdrozenia)

### 1. `POST /api/sync/status`

Wymagane:

- auth header (`Bearer`)
- body:
  - `deviceId`
  - `clientRevision?`
  - `clientHash?`

Zwraca:

- `serverRevision`
- `serverHash`
- `hasServerData`
- `shouldPush`
- `shouldPull`
- `reason`
- (opcjonalnie) `serverUpdatedAt`

### 2. `POST /api/sync/push`

Wymagane:

- auth header
- body:
  - `deviceId`
  - `knownServerRevision?`
  - `archive`

Zwraca:

- `accepted`
- `noOp`
- `revision`
- `payloadSha256`
- `receivedAt`
- `reason`

### 3. `POST /api/sync/pull`

Wymagane:

- auth header
- body:
  - `deviceId`
  - `clientRevision?`

Zwraca:

- `hasUpdate`
- `revision`
- `payloadSha256`
- `receivedAt`
- `archive` (gdy `hasUpdate=true`)
- `reason`

## Definicja Done (server)

Serwer uznajemy za gotowy do normalnego uzycia, gdy:

- [ ] Endpointy sync dzialaja na Railway na DB (bez storage plikowego)
- [ ] Wymagana jest autoryzacja i nie da sie syncowac cudzym `userId`
- [ ] Payload ma limity i walidacje
- [ ] Logi sa wystarczajace do diagnozy problemow
- [ ] Jest healthcheck i monitoring podstawowych bledow
- [ ] Jest backup/retencja i przetestowany restore
- [ ] Klient dashboard syncuje sie z Railway bez regresji MVP

## Lista rzeczy do zrobienia od razu (kolejnosc praktyczna)

Jesli chcesz wejsc w implementacje od razu, najrozsadniejsza kolejnosc jest taka:

1. W repo serwera: Prisma + Postgres schema + migracje
2. Refaktor `sync-store` -> `sync repository` na DB
3. Auth token-based dla `/api/sync/*`
4. Walidacja payloadu + limity
5. Healthcheck + logi strukturalne
6. Deploy na Railway + testy end-to-end z klientem

## Notatki organizacyjne (po przeniesieniu folderu)

- Ten plik mozna skopiowac do repo serwera jako `plan.md` lub `server_plan.md`.
- W glownym repo warto zostawic tylko skrot i link do repo serwera.
- Jesli podasz nowa sciezke lokalna repo serwera, moge przygotowac kolejny krok:
  - konkretne pliki/foldery do utworzenia,
  - skeleton Prisma schema,
  - auth middleware,
  - plan migracji z MVP file store do DB.

