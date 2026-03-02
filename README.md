# TimeFlow Sync Server (Next.js API)

Serwer sync dla dashboardu/klienta TimeFlow. Aktualny etap:

- endpointy `POST /api/sync/status|push|pull`,
- token-based auth (`Authorization: Bearer <token>`),
- walidacja payloadu + limity rozmiaru,
- rate limiting (in-memory, best-effort),
- JSON logs + `x-request-id`,
- healthcheck `GET /api/health`,
- file storage (MVP) zaabstrahowany pod przyszłą migrację do DB,
- scaffold `prisma/schema.prisma` pod Postgres.

## Szybki start (local)

1. Skopiuj `.env.example` do `.env.local` i ustaw token(y).
2. Uruchom:

```bash
npm install
npm run dev
```

3. Healthcheck:

```bash
curl http://localhost:3000/api/health
```

## Auth (token per user)

`SYNC_API_TOKENS` używa formatu:

```env
SYNC_API_TOKENS=userA=super-secret-token,userB=another-token
```

Dla requestów sync wymagany jest nagłówek:

```http
Authorization: Bearer super-secret-token
```

Klient desktop/dashboard musi wysyłać token przypisany do `userId` (nagłówek `Bearer`).

`userId` w body jest nadal akceptowany dla kompatybilności MVP, ale:

- przy tokenie musi zgadzać się z użytkownikiem przypisanym do tokena,
- bez tokena działa tylko fallback deweloperski (`SYNC_ALLOW_INSECURE_DEV_USERID_FALLBACK=true`).

## CORS (Tauri / web)

Endpointy `/api/sync/*` obsługują CORS + preflight `OPTIONS`.

- `SYNC_ALLOWED_ORIGINS=*` (lub puste) pozwala na dowolny origin,
- można też podać listę CSV (np. `http://localhost:1420,tauri://localhost`).

## Endpointy

- `POST /api/sync/status`
- `POST /api/sync/push`
- `POST /api/sync/pull`
- `GET /api/health`

API sync zwraca `x-request-id` i używa `Cache-Control: no-store`.

## Storage (aktualnie)

Stan sync jest zapisywany w `data/sync-store.json` (plik lokalny) z mutexem procesowym, co poprawia zachowanie przy równoległych requestach w ramach jednej instancji.

Można nadpisać katalog storage przez `SYNC_DATA_DIR` (np. na Railway ustaw `SYNC_DATA_DIR=/data`, jeśli volume jest zamontowany pod `/data`).

To jest etap przejściowy przed migracją na Postgresa/Prisma.

## Prisma / Postgres (scaffold)

Dodany został `prisma/schema.prisma` zgodny z `server_plan.md` (tabele `users`, `devices`, `sync_heads`, `sync_snapshots`, `sync_events`), ale runtime nadal korzysta z file storage.

Kolejny krok:

1. dodać `prisma` + `@prisma/client`,
2. wygenerować migrację,
3. podmienić `FileSyncRepository` na implementację DB.

