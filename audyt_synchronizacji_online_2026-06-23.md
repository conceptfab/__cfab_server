# Audyt procesu synchronizacji online — TIMEFLOW Server

| | |
|---|---|
| **Repo** | `__cfab_server` (timeflow_server) |
| **Commit** | `ea04935` (HEAD, branch `main`) |
| **Data audytu** | 2026-06-23 |
| **Zakres** | Cała powierzchnia synchronizacji online: direct-sync (revision), async-delta, sync sesyjny (master/slave), adaptery storage (SFTP/S3), warstwa licencji/urządzeń/auth, panel admina |
| **Metoda** | Statyczny przegląd kodu. Rdzeń (direct-sync, http, server-auth, env, schema, contracts, hash, rate-limit) czytany ręcznie; ścieżki async / sesyjna+storage / licencje zaudytowane przez 3 równoległych agentów. Bez uruchamiania runtime/testów. |

> ⚠️ Raport dotyczy **serwera**. Osobne ustalenie po stronie klienta (dashboard demona) — „synchronizacja online startuje sama" — opisane na końcu w sekcji „Aneks: klient".

---

## 1. Streszczenie zarządcze

Szkielet jest poprawny (uwierzytelnianie bearer-token, rate-limit, AES-GCM na credentialach, TTL sesji, cleanup, walidacja rozmiaru payloadu), ale audyt ujawnił **trzy strukturalne problemy** i kilka realnych wektorów utraty danych:

1. **Eskalacja do admina + wyciek sekretów (łańcuch Critical).** Cookie panelu przechowuje *prawdziwy* sync token w plaintext (base64url), `admin-auth` traktuje **każdego** uwierzytelnionego sync-usera jak admina, a admin API **zwraca sekrety w odpowiedzi** (hasła SFTP/S3, device-tokeny). Razem: zwykły użytkownik wyciąga wszystkie poświadczenia infrastruktury.
2. **Wydawanie surowych/globalnych poświadczeń storage klientowi.** Klient dostaje pełne hasło SFTP backendu lub **globalne klucze konta S3**, bez scope do swojej ścieżki i bez wygaszania. Kompromitacja jednego klienta = trwały dostęp do storage całej grupy/konta. Dodatkowo SFTP **nie weryfikuje host key** → realny MITM.
3. **Rozjazd modelu trwałości + wektory utraty danych.** Stan sync trzymany jest na **filesystemie** (`data/`), a modele DB w `schema.prisma` (`SyncHead`/`SyncSnapshot`) i `online-sync-repository.ts` to **martwy kod**. Zapis snapshotu nie jest atomowy, mutex i rate-limit są tylko in-process (padają na multi-instance/serverless), tombstony nie są persystowane (resurrection skasowanych rekordów), a przejścia stanu paczek async nie są atomowe (broadcast gubi dane).

Rekomendacja: zanim ścieżka pójdzie produkcyjnie — rozdziel role admina, przestań wydawać surowe creds storage, wymuś granicę device/group z tokena (nie z body), uatomicznij przejścia stanu i przenieś stan sync z FS do Postgresa.

---

## 2. Architektura (jak to faktycznie działa)

- **Trzy równoległe protokoły sync** współdzielą jeden chokepoint `handleSyncPost` (`src/lib/sync/http.ts`): auth → rate-limit → parse → execute.
  - **direct-sync** (`direct-sync.ts`) — revision-based; status / push (pełny) / delta-pull / delta-push / ack. Merge po stronie serwera po kluczach naturalnych.
  - **async-delta** (`async-delta.ts`) — paczki delta wymieniane między urządzeniami grupy przez storage (SFTP/S3).
  - **sesyjny** (`session-service.ts`, `session-store.ts`) — handshake master/slave przez storage, serwer pośredniczy stanem i wydaje creds.
- **Trwałość = pliki na dysku, nie Prisma.**
  - Stan sync: `DATA_DIR/online-sync/<userId>/{meta.json, snapshot.json.gz}` + `_history.json`.
  - Licencje/urządzenia/storage-backendy: `DATA_DIR/license-store.json`.
  - Sesje i paczki async: **to akurat w Prisma/Postgres** (`SyncSession`, `AsyncDeltaPackage`).
  - Modele `SyncHead`/`SyncSnapshot`/`SyncEvent` + `online-sync-repository.ts` — **nieużywane nigdzie w kodzie**.
- **Model zaufania:** token (env `SYNC_API_TOKENS` albo device-token z license-store) → `userId = group.ownerId`. `deviceId`/`groupId` z body **nie są** wiązane z tokenem (patrz H3/C4).

---

## 3. Findings — tabela zbiorcza

| ID | Sev | Tytuł | Plik (≈) |
|----|-----|-------|----------|
| C1 | Critical | Cookie panelu = sync token w plaintext po stronie klienta | `auth/dashboard-page-auth.ts:48-88` |
| C2 | Critical | Każdy uwierzytelniony sync-user = admin (brak ról) | `auth/admin-auth.ts:50-60` |
| C3 | Critical | Admin API zwraca sekrety w odpowiedzi (storage creds, device tokeny) | `api/admin/storage-backend/*`, `api/admin/license/[id]/devices` |
| C4 | Critical | `deviceId` z body niezweryfikowany → ack/reject paczki „w imieniu" innego urządzenia (utrata danych) | `async-delta.ts` + `auth/server-auth.ts:106-112` |
| H1 | High | Surowe/globalne creds storage wydawane klientowi bez scope/TTL | `async-delta.ts:294-310`, `session-store.ts:486` |
| H2 | High | Brak weryfikacji host key SFTP → MITM (FTP plaintext) | `sftp-manager.ts:69-74,395-401` |
| H3 | High | Cross-group leak — `groupId` z body ufany (owner z wieloma grupami) | `async-delta.ts:62-69,157-163` |
| H4 | High | Nieatomowe przejście stanu paczki → broadcast konsumowany wielokrotnie/kasowany dla innych | `async-delta.ts:190-241`, `session-store.ts:602-620` |
| H5 | High | Brak CSRF na mutacjach admina (cookie sameSite=lax) | `sync/admin-http.ts`, `auth/admin-auth.ts:50` |
| H6 | High | `refresh-token` nic nie robi — device-token stały i bezterminowy | `api/license/refresh-token/route.ts:24-33` |
| H7 | High | Tombstony nie persystowane → resurrection skasowanych rekordów | `direct-sync.ts:621-640` |
| H8 | High | Zapis snapshotu nie atomowy → korupcja całego snapshotu przy crashu | `direct-sync.ts:217-223` |
| H9 | High | Mutex + rate-limit in-process → lost-update i bypass na multi-instance | `direct-sync.ts:33-52`, `security/rate-limit.ts`, `license-store.ts:91-105` |
| M1 | Medium | Limity strukturalne JSON (array/keys/depth) martwe → DoS, merge kwadratowy | `config/env.ts` (def.), brak egzekwowania |
| M2 | Medium | Device-token: plaintext `===`, nie timing-safe, liniowy skan, plaintext at-rest | `license-store.ts:474-490` |
| M3 | Medium | `storageCredentialsSentAt` martwe — brak gatingu rolą/fazą i TTL creds | `session-service.ts:249`, `session-store.ts:521` |
| M4 | Medium | Brak egzekwowania limitu rozmiaru/quoty storage (`fileSizeBytes` z body ufany) | `sftp-manager.ts:190-197`, `async-delta.ts:120` |
| M5 | Medium | DEV fallback userId bez tokenu (domyślnie ON poza prod) | `auth/server-auth.ts:117-119` |
| M6 | Medium | CORS domyślnie `*` (sync i admin); activate hardcoded `*` | `sync/http.ts:56`, `sync/admin-http.ts:15`, `api/license/activate` |
| M7 | Medium | stepLog read-modify-write bez FOR UPDATE → lost update wpisów | `session-store.ts:285-295` |
| M8 | Medium | Expiry niespójne — ack/reject/credentials nie filtrują `expiresAt` | `session-store.ts` (`getAsyncPackage`) |
| M9 | Medium | Merge po kluczach naturalnych kolabuje różne rekordy; `updated_at` jako string (LWW) | `direct-sync.ts:646-803` |
| M10 | Medium | Martwy kod DB sync (SyncHead/SyncSnapshot/repository) — mylący rozjazd FS vs DB | `prisma/schema.prisma:45-95`, `online-sync-repository.ts` |
| L1 | Low | `forceFullSync` mutuje sesję bez warunku userId (latentny IDOR) | `session-service.ts:139-143` |
| L2 | Low | Heartbeat bez górnego limitu TTL → nieskończone przedłużanie sesji + creds | `session-service.ts:361-365` |
| L3 | Low | Brak twardej sanityzacji segmentów ścieżek storage (`..`/`/`) | `sftp-manager.ts:83`, `session-cleanup.ts` |
| L4 | Low | Expiry/reject paczki bez retry/powiadomienia nadawcy → ciche zgubienie zmian | `async-delta.ts:122,237-241` |
| L5 | Low | Brak rate-limit per-licenseKey przy aktywacji (tylko per-IP) | `api/license/activate/route.ts` |
| L6 | Low | `assignment_feedback` dedup po `source\|created_at` (kolizja gubi rekord); brak remapu id | `direct-sync.ts:805-839` |

---

## 4. Findings — szczegóły

### Critical

**C1 — Cookie panelu przechowuje prawdziwy sync token w plaintext (client-side).**
`dashboard-page-auth.ts:48-88` — cookie `timeflow_sync_dashboard_auth` = `base64url(JSON{userId, token})`, gdzie `token` to realny wpis z `SYNC_API_TOKENS`, re-walidowany przy każdym żądaniu. base64url ≠ szyfrowanie. Przechwycenie cookie (XSS, log, proxy, brak `secure` poza prod) = trwały bearer do całego sync API (token statyczny, nierotowalny).
*Fix:* trzymaj w cookie losowy opaque session-id mapowany serwerowo; nigdy sam token.

**C2 — Każdy sync-user jest adminem.**
`admin-auth.ts:50-60` — fallback akceptuje *dowolny* ważny cookie dashboardu (`if (userId) return`). Brak allowlisty/roli admina. Dowolny wpis w `SYNC_API_TOKENS` → tworzenie/usuwanie licencji, edycja storage-backendów, deaktywacja cudzych urządzeń.
*Fix:* cookie-fallback tylko dla userId z jawnej allowlisty adminów (osobny env).

**C3 — Admin API zwraca sekrety w treści odpowiedzi.**
GET `/admin/storage-backend` i `/[id]` zwracają pełny `StorageBackendConfig` z `password`/`secretAccessKey`; `/admin/license/[id]/devices` zwraca surowe `apiToken` każdego urządzenia (publiczny `/license/status` celowo je pomija — tu mapowania brak). W połączeniu z C1+C2: zwykły user wyciąga wszystkie poświadczenia SFTP/S3 i device-tokeny.
*Fix:* maskuj `password`/`secretAccessKey`/`apiToken` w serializacji odpowiedzi admina.

**C4 — `deviceId` z body niezweryfikowany względem tokena (spoofing w obrębie konta).**
`authenticateSyncRequest` (`server-auth.ts:106-112`) mapuje token → `group.ownerId` i **porzuca** `device` z `findDeviceByToken`. Żaden handler async nie sprawdza `body.deviceId === token.device`. Urządzenie A z ważnym tokenem może `ack`/`reject` paczkę z `deviceId` ofiary B → paczka oznaczona delivered i skasowana ze storage zanim B ją pobierze → **utrata danych B**. W `push` `fromDeviceId` brany wprost z body.
*Fix:* przepuść `device.deviceId` do `SyncAuthContext` i egzekwuj `body.deviceId === auth.deviceId` dla device-tokenów.

### High

**H1 — Surowe/globalne poświadczenia storage wydawane klientowi.**
`async-delta.ts:294-310` (`credentials`) i `session-store.ts:486` (`storageCredentials`) oddają pełny `username`/`password` SFTP lub `accessKeyId`/`secretAccessKey` S3 (**globalne klucze konta**). Szyfrowanie AES-GCM chroni tylko transport (klucz pochodny od `packageId`, który klient zna) — **nie ogranicza zakresu**. Brak scope do `async/<packageId>/`; SFTP user widzi cały `basePath` (wszystkie grupy/sesje), S3 — cały bucket i cokolwiek innego trzyma ten klucz. Brak rotacji/TTL.
*Fix:* efemeryczne, scoped creds — S3 STS / presigned URL per-prefix, SFTP konto per-prefix; nigdy surowe hasło backendu / globalne klucze.

**H2 — SFTP bez weryfikacji host key (MITM).**
`sftp-manager.ts:69-74` — `sftp.connect({host,port,username,password})` bez `hostVerifier`/known-hosts; `ssh2` akceptuje dowolny klucz hosta. Atakujący na ścieżce sieciowej przechwytuje hasło SFTP i cały transfer bazy. FTP (`secure` opcjonalny, `:395-401`) — plaintext jeszcze gorszy.
*Fix:* `hostVerifier` na fingerprint z konfiguracji backendu; wymuś `secure` dla FTP.

**H3 — Cross-group leak przez `groupId` z body.**
`async-delta.ts:62-69,157-163` — autoryzacja sprawdza tylko `group.ownerId === userId`. Owner z >1 grupą: urządzenie grupy X podaje `groupId` grupy Y i pushuje/listuje/wyłudza creds do storage Y. Granica między grupami nieegzekwowana.
*Fix:* weryfikuj, że `device.groupId` z tokena == `body.groupId`/`pkg.groupId`.

**H4 — Nieatomowe przejście stanu paczki async.**
`ack`/`reject` to read-modify-write (`getAsyncPackage` → check `status==="pending"` → `updateAsyncPackageStatus` **bez warunku statusu**). Dwa urządzenia przechodzą check równolegle; dla paczki `toGroupDevices:true` pierwszy ack kasuje storage dla **wszystkich** pozostałych urządzeń grupy (`deliveredToDeviceId` jest pojedyncze — broadcast-do-N jest fundamentalnie zepsuty) → **utrata danych**.
*Fix:* `updateMany({where:{id,status:"pending"},...})` + sprawdzaj `count===1`; model per-recipient delivery dla broadcastu.

**H5 — Brak CSRF na mutacjach admina (cookie).**
`admin-http.ts`/`admin-auth.ts:50` — mutacje (POST/PATCH/DELETE) autoryzują cookie `sameSite:"lax"` (przepuszcza top-level POST), brak tokenu CSRF / sprawdzenia `Origin`. Złośliwa strona może np. DELETE licencji/storage w imieniu zalogowanego admina.
*Fix:* `sameSite:"strict"` dla cookie panelu **lub** CSRF-token/weryfikacja `Origin` na mutacjach.

**H6 — `refresh-token` jest no-opem.**
`refresh-token/route.ts:24-33` — zawsze zwraca „token valid", nie generuje nowego, nie unieważnia starego (przyznaje to komentarz). Skradziony device-token ważny bezterminowo.
*Fix:* realny refresh (nowy token + unieważnienie poprzedniego) albo usuń mylący endpoint.

**H7 — Tombstony nie są persystowane (resurrection).**
`direct-sync.ts:621-640` — tombstony z delty są aplikowane do bieżącego snapshotu i **odrzucane**; serwer nie trzyma historii usunięć. Urządzenie offline, które nie widziało tombstona, przy następnym delta-push wnosi skasowany rekord jako zwykły wiersz → **rekord wraca**. Klasyczny wektor utraty/rozjazdu danych (znany z LAN tego projektu).
*Fix:* trwała tabela tombstonów per-user z czasem usunięcia; przy merge odrzucaj wiersze starsze niż tombstone.

**H8 — Zapis snapshotu nie jest atomowy.**
`direct-sync.ts:217-223` — `writeSnapshotGz` robi `writeFile(gzPath, …)` bez wzorca tmp+rename (którego `writeJson`/meta używa, `:211-213`). Crash/awaria w trakcie zapisu = uszkodzony `snapshot.json.gz` = **utrata całego snapshotu usera**. Dodatkowo meta i snapshot to dwa osobne, nieatomowe zapisy → możliwy rozjazd revision↔snapshot.
*Fix:* zapis snapshotu przez tmp+rename; rozważ wspólny commit meta+snapshot.

**H9 — Współbieżność tylko in-process.**
`withUserMutex` (`direct-sync.ts:33-52`), `rate-limit` (mapa w pamięci) i `license-store` (mutex JS) działają w obrębie jednego procesu. Na multi-instance/serverless: równoległe delta-push czytają tę samą `revision=N`, oba przechodzą stale-base-check, oba zapisują `N+1` → **lost update**; rate-limit per-instancja (omijalny, dodatkowo klucz po `x-forwarded-for` — spoofowalny); license-store last-write-wins gubi zapisy.
*Fix:* pojedynczy writer / blokada w Postgresie (advisory lock / transakcyjny UPDATE warunkowy); rate-limit współdzielony (np. Redis); nie ufaj pierwszemu `x-forwarded-for`.

### Medium

**M1 — Limity strukturalne JSON martwe (DoS).** `syncMaxArrayItems`/`syncMaxObjectKeys`/`syncMaxJsonDepth` zdefiniowane i walidowane w `env.ts`, **nigdzie nieużywane**. Chroni tylko `syncMaxPayloadBytes` (20 MB raw; gzip do 2× compressed). Merge delta używa `findIndex` w pętli → **kwadratowy** (O(n·m)); delta z dziesiątek tysięcy rekordów = blokada event-loopu. *Fix:* egzekwuj limity przy parsowaniu; rozważ mapy zamiast `findIndex`.

**M2 — Device-token plaintext, nie timing-safe.** `license-store.ts:474-490` — `device.apiToken === token` w pętli (kontrast: env/admin używają `timingSafeEqual`); token plaintext at-rest w `license-store.json`. *Fix:* hashuj token (SHA-256), lookup po haszu, porównanie `timingSafeEqual`.

**M3 — Wydawanie creds bez gatingu i TTL.** `storageCredentialsSentAt` (`session-store.ts:521`) tylko zapisywane, nigdy nie czytane jako warunek. `handleSessionStatus` (`session-service.ts:249`) zwraca creds przy każdym pollu, niezależnie od fazy/roli (też masterowi). *Fix:* bramkuj wydanie creds rolą+fazą; egzekwuj TTL względem `storageCredentialsSentAt`.

**M4 — Brak quoty/limitu rozmiaru storage.** `sftpMaxFileSizeMb` wczytany, nieegzekwowany; `fileSizeBytes` z body ufany bez weryfikacji realnego uploadu. Klient zapisuje bezpośrednio swoimi creds → storage exhaustion / koszt S3. *Fix:* quota po stronie storage (bucket policy / limit konta SFTP) + walidacja deklarowanego rozmiaru (HEAD przed ack).

**M5 — DEV bypass auth.** `server-auth.ts:117-119` — gdy `syncAllowInsecureDevUserIdFallback` (domyślnie `true` poza prod), `bodyUserId` wystarcza za auth. Jedno przeoczenie `NODE_ENV` = pełny bypass. *Fix:* twardszy warunek (jawny `ALLOW_INSECURE=1` *i* `!isProduction`) + log-warn przy starcie.

**M6 — CORS `*` domyślnie.** Puste `SYNC_ALLOWED_ORIGINS` → `allow-origin:*` (sync i admin); `activate` ma `*` na sztywno. Dla bearer mniej krytyczne (brak `allow-credentials`), ale admin cookie + `*` zwiększa powierzchnię. *Fix:* wymagaj jawnej listy origin w produkcji; nie domyślaj `*` dla admina.

**M7 — stepLog lost update.** `session-store.ts:285-295` — read tablicy → push → write całości; pod domyślnym READ COMMITTED bez `FOR UPDATE` dwa równoległe raporty master+slave mogą się nadpisać → zła detekcja completion / marker-mismatch. *Fix:* `SELECT … FOR UPDATE` albo atomowy append.

**M8 — Niespójne expiry paczek.** `getPendingPackagesForGroup` filtruje `expiresAt>now`, ale `getAsyncPackage` (ack/reject/credentials) sprawdza tylko `status==="pending"` → wydanie creds do technicznie wygasłej paczki. *Fix:* dodaj warunek `expiresAt>now` w ack/reject/credentials.

**M9 — Merge po kluczach naturalnych.** `direct-sync.ts:646-803` — projekty po `lowercase(name)`, apps po `lowercase(executable_name)`: różne realne rekordy o tej samej nazwie **kolabują w jeden**. Sesje po `app_id+start_time`. Konflikt rozstrzygany `incomingUpdated >= existingUpdated` jako **porównanie stringów** (działa tylko dla jednolitego ISO-8601 UTC; ties nadpisują). *Fix:* stabilne klucze (uuid/sync_key), porównanie czasu jako timestamp, jawna polityka konfliktu.

**M10 — Martwy kod modelu DB.** `SyncHead`/`SyncSnapshot`/`SyncEvent` (`schema.prisma:45-95`) i `online-sync-repository.ts` nieużywane — schemat sugeruje trwałość DB, realnie FS. Mylące, ryzyko regresji, brak transakcyjności. *Fix:* albo zmigruj stan sync na te modele (zalecane, rozwiązuje H8/H9), albo usuń martwy kod.

### Low

**L1** — `forceFullSync` (`session-service.ts:139-143`) woła `updateSessionSyncMode` bez warunku `userId` (tu sessionId z join, ale wzorzec niebezpieczny — latentny IDOR). *Fix:* mutacja wewnątrz `withValidatedSession`.
**L2** — heartbeat (`session-service.ts:361-365`) zawsze przedłuża TTL bez górnego limitu → sesja + creds żyją w nieskończoność. *Fix:* cap `min(now+slide, createdAt+MAX_LIFETIME)`.
**L3** — segmenty ścieżek storage z id (UUID/cuid serwerowe, więc niska ekspozycja) bez twardej walidacji `^[A-Za-z0-9_-]+$`. *Fix:* sanityzuj segmenty przed budową ścieżki.
**L4** — paczka po expiry/reject znika bez retry/powiadomienia nadawcy → ciche zgubienie zmian przy długim offline. *Fix:* status do pollowania + wymuszony re-push od aktualnego markera.
**L5** — aktywacja rate-limit tylko per-IP; brak per-licenseKey (entropia klucza ~40 bit, akceptowalna, ale CRC16 ułatwia odsiew). *Fix:* rate-limit/lockout per-licenseKey.
**L6** — `assignment_feedback` dedup po `source|created_at` (kolizja gubi rekord); `assignment_feedback`/`auto_runs` bez remapu project/app id (możliwe wiszące referencje). *Fix:* stabilny klucz dedup + remap id jak dla sesji.

---

## 5. Co jest zrobione dobrze (pozytywy)

- **Autoryzacja sesji bez IDOR:** `withValidatedSession` (`session-store.ts:459-495`) egzekwuje `userId` **oraz** rolę (deviceId ∈ {master,slave}) w transakcji — znajomość cuid nie wystarcza do przejęcia sesji.
- **Kryptografia creds:** AES-256-GCM (AEAD, weryfikowany tag), losowy 12-bajtowy IV per wywołanie (brak nonce reuse), per-session HKDF rozdzielający klucze credential/file. Solidne.
- **Timing-safe** porównania dla env-tokenów i admin-tokenu.
- **Keygen:** rejection sampling bez modulo-bias; CRC16 jako format-check (nie sekret).
- **Race przy join:** `findAndJoinOrCreate` atomowy; `joinSession` waliduje `awaiting_peer` (brak podwójnego slave).
- **Atomowy zapis** `meta.json` i `license-store.json` (tmp+rename); cleanup kasuje storage przed rekordem + orphan-sweep.
- **Walidacja payloadu:** limit raw + gzip (2× guard na bombę), Content-Type, pusty body.

---

## 6. Priorytety naprawcze

1. **Rozdział ról admina + opaque session cookie + redakcja sekretów w odpowiedziach admina** → C1, C2, C3, H5.
2. **Koniec z surowymi creds storage:** efemeryczne, scoped (S3 STS/presigned, SFTP per-prefix) z TTL; **host-key verification SFTP** → H1, H2, M3, M4.
3. **Granica device/group z tokena (nie z body) + atomowe przejścia stanu paczek** (`updateMany where status`) → C4, H3, H4.
4. **Trwałość:** serwerowe tombstony + atomowy zapis snapshotu + przeniesienie stanu sync z FS do Postgresa (transakcje, multi-instance) → H7, H8, H9, M10.
5. **Twardienie wejścia:** egzekwuj limity JSON (depth/array/keys) i quoty storage; timing-safe + hash device-tokenu at-rest → M1, M2.

---

## Aneks: klient (dashboard demona) — „synchronizacja online startuje sama"

Osobne ustalenie, poza serwerem (repo `__cfab_demon`): przełącznik **„Sync on startup" bramkuje wyłącznie** jednorazowy sync demona 10 s po starcie procesu (`src/main.rs:117-130`) — działa poprawnie. Ale dopóki okno dashboardu jest otwarte z **„Enable online sync" = ON**, dashboard sam napędza pełny sync demona (`run_online_sync_forced`) na kilku pętlach bramkowanych **tylko** przez `enabled`, niezależnych od „Sync on startup" i od ustawienia „Auto sync interval":

- `runDaemonOnlineSyncInterval` — co **60 s** (dominanta), `useJobPool.ts:139-158`;
- `runSync('poll')` — co **120 s**, `job-pool-helpers.ts:209`;
- `runSync('interval')` — pierwszy po **30 s** od otwarcia, potem co `autoSyncIntervalMinutes`;
- przy zmianie danych lokalnych (+1,5 s) i przy ponownym fokusie okna (natychmiast).

Efekt: „Auto sync interval: 30 min" jest praktycznie martwe (realny takt ~60 s). Uzgodniony kierunek naprawy: **respektuj 30 min** — usunąć pętlę 60 s i poll 120 s, jedyny okresowy trigger = `autoSyncIntervalMinutes`, pierwszy sync po starcie tylko gdy „Sync on startup" = ON. (Naprawa do wdrożenia po stronie klienta.)
