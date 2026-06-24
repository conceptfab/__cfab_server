# TimeFlow Sync Server (Next.js API)

Serwer sync dla dashboardu/klienta TimeFlow. Aktualny etap:

- endpointy `POST /api/sync/status|push|pull`,
- token-based auth (`Authorization: Bearer <token>`),
- walidacja payloadu + limity rozmiaru,
- rate limiting (in-memory, best-effort),
- JSON logs + `x-request-id`,
- healthcheck `GET /api/health`,
- cały stan trwały w Postgres (Prisma) — bez zależności od dysku,
- deploy serverless na Vercel (Neon Postgres + Vercel Cron).

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

## Storage (Postgres)

Cały stan trwały żyje w Postgres (Prisma): licencje/grupy/urządzenia/storage-backendy, online-sync
(`sync_heads`, `sync_snapshots`), sesje sync, historia i feedback. Brak zależności od lokalnego dysku —
aplikacja działa poprawnie na serverless (Vercel). `SYNC_DATA_DIR` nie jest już używany.

## Deploy na Vercel

1. **Postgres (Neon):** w Vercel → Storage podłącz integrację Neon. Ustawi `DATABASE_URL` (pooled).
   Dodatkowo ustaw `DIRECT_URL` = wartość `*-UNPOOLED` (potrzebne dla `prisma migrate`).
2. **Zmienne środowiskowe:** ustaw w Vercel zmienne z `.env.example` (m.in. `SYNC_API_TOKENS`,
   `ADMIN_API_TOKEN`, `CRON_SECRET`, a przy SFTP — `SYNC_ENCRYPTION_KEY` ≥ 32 znaki).
3. **Build:** `npm run build` uruchamia `prisma generate && prisma migrate deploy && next build`
   (migracje aplikują się przy deployu, na `DIRECT_URL`).
4. **Cron:** `vercel.json` definiuje cron `*/10 * * * *` → `GET /api/cron/session-cleanup`
   (czyści wygasłe sesje; auth przez `CRON_SECRET`).

```bash
# lokalnie, po ustawieniu DATABASE_URL + DIRECT_URL
npm install
npx prisma migrate deploy
npm run dev
```

Migracje schematu: `npx prisma migrate dev --name <opis>` (tworzy migrację z `prisma/schema.prisma`).

