# Plan implementacji — Online Sync poprawki i rozszerzenia

**Data:** 2026-04-02
**Zrodlo:** `lan_raport.md` (analiza rozbieznosci `online.md` vs kod)
**Repozytoria:** `__server` (Next.js), `__client` (Rust daemon + Tauri dashboard)

---

## KOLEJNOSC FAZ

```
FAZA 1: Czyszczenie serwera (usuniecie starego modelu)
    ↓
FAZA 2: Storage backends per grupa
    ↓
FAZA 3: Egzekwowanie licencji
    ↓
FAZA 4: Stabilnosc klienta (heartbeat, timeout, retry)
    ↓
FAZA 5: UI serwera (nowy dashboard)
    ↓
FAZA 6: Async delta sync (store-and-forward)
    ↓
FAZA 7: Brakujace endpointy i historia
```

---

## FAZA 1: Czyszczenie serwera (usuniecie starego modelu)

**Cel:** Serwer przestaje przechowywac dane biznesowe i scalac bazy. Zostaje tylko koordynatorem sesji.

**Ryzyko:** Srednie — stare endpointy moga byc jeszcze uzywane przez klientow w terenie.

### 1.1 Usuniecie merge z serwera

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 1.1.1 | Usunac `mergeArchiveData()` | `__server/src/lib/sync/service.ts` | Funkcja merge i `upsertRows()` — cala logika scalania |
| 1.1.2 | Usunac `pushSnapshot()` logike merge | `__server/src/lib/sync/service.ts` | Push nie powinien scalac, tylko przekazywac |
| 1.1.3 | Usunac `pushDelta()` logike merge | `__server/src/lib/sync/service.ts` | j.w. |

### 1.2 Usuniecie przechowywania snapshotow

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 1.2.1 | Usunac pole `archive` z sync-store.json | `__server/src/lib/sync/repository.ts` | Serwer nie przechowuje payloadu baz |
| 1.2.2 | Usunac `latestSnapshot`, `snapshots[]` | `__server/src/lib/sync/repository.ts` | Retencja snapshotow niepotrzebna |
| 1.2.3 | Usunac pruning/retention logic | `__server/src/lib/sync/service.ts` | `SYNC_SNAPSHOT_RETENTION_COUNT` i powiazana logika |
| 1.2.4 | Usunac `SYNC_SNAPSHOT_RETENTION_COUNT` z env | `__server/src/lib/config/env.ts` | Zmienna srodowiskowa bez zastosowania |

### 1.3 Usuniecie/wylaczenie starych endpointow

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 1.3.1 | Usunac `/api/sync/push` | `__server/src/app/api/sync/push/` | Caly katalog |
| 1.3.2 | Usunac `/api/sync/pull` | `__server/src/app/api/sync/pull/` | Caly katalog |
| 1.3.3 | Usunac `/api/sync/delta-push` | `__server/src/app/api/sync/delta-push/` | Caly katalog |
| 1.3.4 | Usunac `/api/sync/delta-pull` | `__server/src/app/api/sync/delta-pull/` | Caly katalog |
| 1.3.5 | Usunac `/api/sync/ack` | `__server/src/app/api/sync/ack/` | Zastapiony przez `/sync/session/{id}/report` |
| 1.3.6 | Usunac `/api/sync/status` | `__server/src/app/api/sync/status/` | Zastapiony przez `/sync/session/{id}/status` |
| 1.3.7 | Usunac route specs w http.ts | `__server/src/lib/sync/http.ts` | Wyrejestrowac stare route'y |
| 1.3.8 | Usunac validation.ts (stare body) | `__server/src/lib/sync/validation.ts` | `validatePushBody`, `validatePullBody`, `validateAckBody` — niepotrzebne |

### 1.4 Czyszczenie service.ts

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 1.4.1 | Usunac `getSyncStatus()` | `__server/src/lib/sync/service.ts` | Stara logika revision/hash |
| 1.4.2 | Usunac `pullSnapshot()` | `__server/src/lib/sync/service.ts` | Transfer przez storage, nie HTTP |
| 1.4.3 | Usunac `ackPulledSnapshot()` | `__server/src/lib/sync/service.ts` | Zastapione przez session report |
| 1.4.4 | Ocenic co zostaje w service.ts | `__server/src/lib/sync/service.ts` | Jesli nic — usunac caly plik |

**Weryfikacja fazy 1:**
- [ ] Serwer startuje bez bledow po usunieciu
- [ ] Endpointy sesji (`/sync/session/*`) dzialaja bez zmian
- [ ] `sync-store.json` nie zawiera pol `archive`, `snapshots`
- [ ] Stare endpointy zwracaja 404 lub 410 Gone

---

## FAZA 2: Storage backends per grupa

**Cel:** Kazda grupa klientow ma wlasny storage backend (SFTP/S3/inne) zamiast globalnego SFTP z `.env`.

### 2.1 Model danych storage backend

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 2.1.1 | Dodac `StorageBackendConfig` typ | `__server/src/lib/sync/license-contracts.ts` | Interfejs bazowy + warianty SFTP, S3 |
| 2.1.2 | Dodac `storageBackends` do `LicenseStoreFile` | `__server/src/lib/sync/license-contracts.ts` | `Record<string, StorageBackendConfig>` |
| 2.1.3 | Dodac typy admin API | `__server/src/lib/sync/license-contracts.ts` | `AdminCreateStorageBackendBody`, `AdminUpdateStorageBackendBody` |

Struktura typu:
```typescript
type StorageBackendType = "sftp" | "aws-s3";

interface StorageBackendBase {
  id: string;
  type: StorageBackendType;
  name: string;                  // "FTP firmowy", "S3 cloud"
  basePath: string;
  maxFileSizeMb: number;
  sessionTtlMinutes: number;
  createdAt: string;
}

interface SftpStorageBackend extends StorageBackendBase {
  type: "sftp";
  host: string;
  port: number;
  username: string;
  password: string;              // encrypted at rest
}

interface S3StorageBackend extends StorageBackendBase {
  type: "aws-s3";
  region: string;
  bucket: string;
  accessKeyId: string;           // encrypted at rest
  secretAccessKey: string;       // encrypted at rest
  usePresignedUrls: boolean;
}

type StorageBackendConfig = SftpStorageBackend | S3StorageBackend;
```

### 2.2 CRUD storage backends

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 2.2.1 | CRUD w license-store.ts | `__server/src/lib/sync/license-store.ts` | `createStorageBackend()`, `getStorageBackend()`, `updateStorageBackend()`, `deleteStorageBackend()` |
| 2.2.2 | Szyfrowanie hasel at rest | `__server/src/lib/sync/license-store.ts` | Hasla/klucze szyfrowane SYNC_ENCRYPTION_KEY przed zapisem do JSON |
| 2.2.3 | Walidacja body | `__server/src/lib/sync/license-validation.ts` | Walidacja typow, wymaganych pol per backend type |

### 2.3 Admin endpointy storage

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 2.3.1 | POST `/admin/storage-backend` | `__server/src/app/api/admin/storage-backend/route.ts` | Tworzenie nowego backendu |
| 2.3.2 | GET `/admin/storage-backend` | j.w. | Lista backendow |
| 2.3.3 | PATCH `/admin/storage-backend/{id}` | `__server/src/app/api/admin/storage-backend/[id]/route.ts` | Aktualizacja |
| 2.3.4 | DELETE `/admin/storage-backend/{id}` | j.w. | Usuniecie (tylko jesli nie przypisany do grupy) |
| 2.3.5 | POST `/admin/storage-backend/{id}/test` | j.w. | Test polaczenia (connect + mkdir + rmdir) |

### 2.4 Lookup backendu w session-service

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 2.4.1 | Przy tworzeniu sesji: `group → storageBackendId → config` | `__server/src/lib/sync/session-service.ts` | Zamiast globalnego `getEnv().sftpHost` |
| 2.4.2 | Refaktor sftp-manager.ts na adapter pattern | `__server/src/lib/sync/sftp-manager.ts` | `createStorageAdapter(config)` zwraca adapter z `createSessionDir()`, `deleteSessionDir()`, `healthCheck()` |
| 2.4.3 | Fallback na globalne env | `__server/src/lib/sync/session-service.ts` | Jesli grupa nie ma backendu → uzyj globalnego SFTP z `.env` (backwards compat) |

### 2.5 Szyfrowanie credentiali per backend

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 2.5.1 | `encryptStorageCredentials()` z config backendu | `__server/src/lib/sync/storage-encryption.ts` | Zamiast globalnych credentiali — z config konkretnego backendu |

**Weryfikacja fazy 2:**
- [ ] Admin moze utworzyc storage backend (SFTP) przez API
- [ ] Admin moze przypisac backend do grupy
- [ ] Sesja sync uzywa backendu przypisanego do grupy klienta
- [ ] Test polaczenia backendu dziala
- [ ] Brak backendu w grupie → fallback na globalne env

---

## FAZA 3: Egzekwowanie licencji

**Cel:** Sync session create sprawdza licencje, plan, limity. Bez waznej licencji — brak sync.

### 3.1 Middleware walidacji licencji

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 3.1.1 | Nowy middleware `validateLicenseForSync()` | `__server/src/lib/sync/license-middleware.ts` | Nowy plik |
| 3.1.2 | Sprawdzenie statusu licencji | j.w. | `expired/suspended/revoked` → 403 z `renewUrl` |
| 3.1.3 | Sprawdzenie limitu urzadzen | j.w. | `activeDevices.length >= maxDevices` → 403 |
| 3.1.4 | Sprawdzenie czestotliwosci sync | j.w. | Ostatni sync < `maxSyncFrequencyHours` → 429 z `retryAfter` |
| 3.1.5 | Sprawdzenie rozmiaru bazy | j.w. | Z `table_hashes` size > `maxDatabaseSizeMb` → 413 |

### 3.2 Integracja z session create

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 3.2.1 | Wywolac `validateLicenseForSync()` w `handleSessionCreate()` | `__server/src/lib/sync/session-service.ts` | Przed tworzeniem sesji |
| 3.2.2 | Lookup: `auth_token → device → group → license` | j.w. | Chain walidacji |
| 3.2.3 | Rozstrzyganie rol z uwzglednieniem `fixedMasterDeviceId` | j.w. | Jesli grupa ma fixed master → ten device zawsze master |

### 3.3 Endpointy licencji dla klientow

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 3.3.1 | POST `/license/activate` | `__server/src/app/api/license/activate/route.ts` | Aktywacja klucza + rejestracja urzadzenia → zwraca auth_token |
| 3.3.2 | GET `/license/status` | `__server/src/app/api/license/status/route.ts` | Stan licencji, plan, limity, lista urzadzen |
| 3.3.3 | POST `/license/deactivate-device` | `__server/src/app/api/license/deactivate-device/route.ts` | Odrejestrowanie urzadzenia (zwalnia slot) |
| 3.3.4 | POST `/license/refresh-token` | `__server/src/app/api/license/refresh-token/route.ts` | Odswiezenie auth_token |

### 3.4 Klient — walidacja i aktywacja

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 3.4.1 | Dodac `license_key` do `OnlineSyncSettings` | `__client/src/config.rs` | Nowe pole w konfiguracji |
| 3.4.2 | Walidacja offline klucza (regex + CRC16) | `__client/src/online_sync.rs` | Przed proba aktywacji |
| 3.4.3 | Aktywacja licencji przy pierwszym uzyciu | `__client/src/online_sync.rs` | POST `/license/activate` → zapis auth_token |
| 3.4.4 | Periodyczne sprawdzanie licencji (co 24h) | `__client/src/main.rs` | GET `/license/status` w tle |
| 3.4.5 | UI: pole klucza licencji w OnlineSyncCard | `__client/dashboard/src/components/settings/OnlineSyncCard.tsx` | Input + przycisk "Aktywuj" |

**Weryfikacja fazy 3:**
- [ ] Klient bez licencji dostaje 403 przy `/sync/session/create`
- [ ] Klient z wygasla licencja dostaje 403 z `renewUrl`
- [ ] Przekroczenie limitu urzadzen → 403
- [ ] Zbyt czesty sync → 429 z `retryAfter`
- [ ] Aktywacja klucza w dashboard dziala
- [ ] Fixed master rozstrzygany poprawnie

---

## FAZA 4: Stabilnosc klienta

**Cel:** Klient jest odporny na wolne lacza, duze bazy, timeouty.

### 4.1 Heartbeat podczas transferu SFTP

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 4.1.1 | Heartbeat w osobnym watku | `__client/src/online_sync.rs` | Spawn watku wysylajacego heartbeat co 10s, kill po zakonczeniu transferu |
| 4.1.2 | Integracja z upload/download | `__client/src/sftp_client.rs` | Przekazanie `stop_signal` do watku heartbeat |

### 4.2 Timeouty

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 4.2.1 | Zwiekszyc `SYNC_TIMEOUT` z 300s do 1800s (30 min) | `__client/src/online_sync.rs` | Globalny timeout sesji |
| 4.2.2 | Dodac per-step timeout 600s (10 min) | `__client/src/online_sync.rs` | Kazdy krok ma wlasny deadline |
| 4.2.3 | Auto-unfreeze po 10 min braku odpowiedzi | `__client/src/online_sync.rs` | Jesli serwer nie odpowiada → unfreeze + rollback |

### 4.3 Retry z exponential backoff

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 4.3.1 | Retry na HTTP requestach do serwera | `__client/src/online_sync.rs` | 3 proby: 5s, 15s, 45s |
| 4.3.2 | Retry na SFTP connect/upload/download | `__client/src/sftp_client.rs` | 3 proby z backoff |

### 4.4 Error recovery

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 4.4.1 | Automatyczne przywracanie z backupu po bledzie merge | `__client/src/online_sync.rs` | Jesli merge/verify fail → restore backup, unfreeze |
| 4.4.2 | Dedykowany `OnlineSyncState` (zamiast reuse `LanSyncState`) | `__client/src/online_sync.rs` | Oddzielny stan dla online sync — brak kolizji z LAN |

### 4.5 Natychmiastowy cleanup po step 13

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 4.5.1 | Trigger cleanup w `handleSessionReport()` przy step 13 | `__server/src/lib/sync/session-service.ts` | Po obu raportach step 13 → natychmiast `deleteSessionDir()` |

**Weryfikacja fazy 4:**
- [ ] Transfer 50 MB nie powoduje timeout sesji (heartbeat dziala)
- [ ] Blad SFTP → retry → sukces po ponownym polaczeniu
- [ ] Blad merge → automatyczny rollback z backupu
- [ ] LAN sync i online sync moga dzialac naprzemiennie bez kolizji stanow

---

## FAZA 5: UI serwera (nowy dashboard)

**Cel:** Dashboard serwera odzwierciedla nowa architekture — sesje, licencje, grupy, storage backends.

### 5.1 Usuniecie starych sekcji z page.tsx

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 5.1.1 | Usunac sekcje "Jak czytac statusy" | `__server/src/app/page.tsx` | Opis push/pull/ack — nieaktualny |
| 5.1.2 | Usunac sekcje snapshotow | j.w. | Kafelki snapshotCount, pendingDevices, tabela Rev/ACK |
| 5.1.3 | Usunac "Payload na serwerze" | j.w. | Serwer nie ma payloadu |
| 5.1.4 | Usunac "Reset historii sync" | j.w. | Operuje na starym sync-store.json |
| 5.1.5 | Usunac import `getSyncDashboardSummary` | j.w. | Funkcja z starego repository.ts |

### 5.2 Nowe sekcje dashboard

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 5.2.1 | Sekcja "Aktywne sesje sync" | `__server/src/app/page.tsx` | Juz istnieje — zostawic, rozbudowac o step log |
| 5.2.2 | Sekcja "Licencje" | j.w. | Tabela: klucz, plan, status, max urzadzen, wygasniecie. Przyciski: dodaj, edytuj, usun |
| 5.2.3 | Sekcja "Grupy klientow" | j.w. | Tabela: nazwa, licencja, storage backend, fixed master. Przyciski: dodaj, edytuj |
| 5.2.4 | Sekcja "Storage backends" | j.w. | Tabela: nazwa, typ, host, status polaczenia. Przyciski: dodaj, edytuj, test polaczenia |
| 5.2.5 | Sekcja "Urzadzenia" | j.w. | Tabela: device_id, nazwa, grupa, last seen, last sync, marker |
| 5.2.6 | Sekcja "Historia synchronizacji" | j.w. | Lista zakonczonych sesji: data, tryb, urzadzenia, czas trwania, status |

### 5.3 Komponenty pomocnicze

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 5.3.1 | Formularz tworzenia licencji | `__server/src/components/license-form.tsx` | Client component z walidacja |
| 5.3.2 | Formularz tworzenia grupy | `__server/src/components/group-form.tsx` | Select licencji, select storage backend |
| 5.3.3 | Formularz storage backend | `__server/src/components/storage-backend-form.tsx` | Dynamiczny formularz wg typu (SFTP/S3) |
| 5.3.4 | Komponent testu polaczenia | `__server/src/components/storage-test-button.tsx` | Przycisk "Testuj" → POST `/admin/storage-backend/{id}/test` |

### 5.4 Server actions / API calls

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 5.4.1 | Funkcja `getDashboardData()` | `__server/src/lib/sync/dashboard.ts` | Nowa funkcja — zbiera sesje, licencje, grupy, backendy, urzadzenia |
| 5.4.2 | Usunac `getSyncDashboardSummary()` | `__server/src/lib/sync/repository.ts` | Stara funkcja oparta o snapshoty |

**Weryfikacja fazy 5:**
- [ ] Dashboard nie pokazuje zadnych elementow starego modelu
- [ ] Admin moze zarzadzac licencjami, grupami, backendami przez UI
- [ ] Test polaczenia storage backendu dziala z poziomu UI
- [ ] Lista sesji pokazuje aktywne i zakonczone

---

## FAZA 6: Async delta sync (store-and-forward)

**Cel:** Klient moze zostawic paczke delta na storage, drugi klient pobiera ja gdy wroci online.

### 6.1 Model danych

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 6.1.1 | Typ `AsyncDeltaPackage` | `__server/src/lib/sync/session-contracts.ts` | id, groupId, fromDeviceId, baseMarkerHash, newMarkerHash, storagePath, status, ttl |
| 6.1.2 | Store paczek w `session-store.json` | `__server/src/lib/sync/session-store.ts` | Sekcja `asyncPackages: Record<string, AsyncDeltaPackage>` |
| 6.1.3 | CRUD paczek | `__server/src/lib/sync/async-delta.ts` | Nowy plik: `createPackage()`, `getPendingPackages()`, `ackPackage()`, `rejectPackage()` |

### 6.2 Endpointy serwera

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 6.2.1 | POST `/sync/async/push` | `__server/src/app/api/sync/async/push/route.ts` | Rejestracja paczki + klient uploaduje na storage |
| 6.2.2 | GET `/sync/async/pending` | `__server/src/app/api/sync/async/pending/route.ts` | Lista oczekujacych paczek dla device_id |
| 6.2.3 | POST `/sync/async/ack` | `__server/src/app/api/sync/async/ack/route.ts` | Potwierdzenie aplikacji paczki → serwer czysci storage |
| 6.2.4 | POST `/sync/async/reject` | `__server/src/app/api/sync/async/reject/route.ts` | Odrzucenie paczki (base_marker mismatch) |

### 6.3 Logika serwera

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 6.3.1 | Walidacja base_marker | `__server/src/lib/sync/async-delta.ts` | Sprawdzenie czy base_marker jest znany |
| 6.3.2 | Tworzenie katalogu na storage | j.w. | `/{basePath}/async/{packageId}/` |
| 6.3.3 | Czyszczenie wygaslych paczek w cleanup job | `__server/src/lib/sync/session-cleanup.ts` | Rozszerzenie o `cleanupExpiredAsyncPackages()` |
| 6.3.4 | Obsluga konfliktu "oba pushuja" | `__server/src/lib/sync/async-delta.ts` | Jesli jest pending paczka → zwroc info "najpierw pobierz" |

### 6.4 Klient — eksport delta

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 6.4.1 | `build_delta_export()` | `__client/src/sync_common.rs` | Eksport rekordow z `updated_at > last_sync_at` + nowe tombstones |
| 6.4.2 | Obliczanie rozmiaru delty | j.w. | Jesli delta > limit → fallback na pelny sync |

### 6.5 Klient — orkiestrator async

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 6.5.1 | Nowy tryb `AsyncDelta` w online_sync.rs | `__client/src/online_sync.rs` | Obok istniejacego trybu sesyjnego |
| 6.5.2 | Przeplyw push | j.w. | `build_delta → encrypt → upload storage → POST /sync/async/push` |
| 6.5.3 | Przeplyw pull | j.w. | `GET /sync/async/pending → download → decrypt → merge → POST /sync/async/ack` |
| 6.5.4 | Przeplyw dwustronny | j.w. | Pull + merge lokalne zmiany + push zwrotna delta |
| 6.5.5 | Fallback na sesyjny | j.w. | Jesli base_marker mismatch i nie da sie mergowac → 13-krokowy sync |
| 6.5.6 | Tryb `auto` | j.w. | Sprawdz pending paczki → jesli sa, pull. Jesli nie, push delta. Jesli peer online → sesyjny |

### 6.6 Klient — konfiguracja

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 6.6.1 | Dodac `sync_mode` do OnlineSyncSettings | `__client/src/config.rs` | `"session" \| "async" \| "auto"` |
| 6.6.2 | UI: wybor trybu sync w OnlineSyncCard | `__client/dashboard/src/components/settings/OnlineSyncCard.tsx` | Select z 3 opcjami |
| 6.6.3 | Status paczek w OnlineSyncCard | j.w. | "Paczka czeka na pobranie" / "Wyslano, oczekuje na odbior" |

### 6.7 Dashboard serwera

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 6.7.1 | Sekcja "Paczki async delta" w dashboard | `__server/src/app/page.tsx` | Tabela: id, from, to, base_marker, status, created, expires |

**Weryfikacja fazy 6:**
- [ ] Klient A pushuje delta, klient B (offline) pobiera po powrocie — markery zgodne
- [ ] Oba klienty pracowaly offline → dwustronny async merge → markery zgodne
- [ ] base_marker mismatch → fallback na sesyjny sync
- [ ] Paczki wygasle → cleanup → klient informowany
- [ ] Tryb `auto` poprawnie wybiera async vs sesyjny

---

## FAZA 7: Brakujace endpointy i historia

**Cel:** Kompletne API zgodne z online.md spec.

### 7.1 Historia synchronizacji

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 7.1.1 | Typ `SyncHistoryEntry` | `__server/src/lib/sync/session-contracts.ts` | id, sessionId, masterDeviceId, slaveDeviceId, syncMode, markerHash, startedAt, completedAt, durationMs |
| 7.1.2 | Zapisywanie historii po zakonczeniu sesji | `__server/src/lib/sync/session-service.ts` | Przy step 13 (oba klienty) → zapis do history |
| 7.1.3 | Store historii | `__server/src/lib/sync/session-store.ts` | `syncHistory: SyncHistoryEntry[]` w session-store.json |
| 7.1.4 | GET `/sync/history` | `__server/src/app/api/sync/history/route.ts` | Lista historii per user (z paginacja) |
| 7.1.5 | GET `/sync/history/{id}` | `__server/src/app/api/sync/history/[id]/route.ts` | Szczegoly sesji (step log) |

### 7.2 Endpointy urzadzen

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 7.2.1 | GET `/sync/devices` | `__server/src/app/api/sync/devices/route.ts` | Lista urzadzen usera (z license-store) |
| 7.2.2 | GET `/sync/devices/{id}` | `__server/src/app/api/sync/devices/[id]/route.ts` | Szczegoly urzadzenia (last sync, marker, grupa) |

### 7.3 Health check rozszerzony

| # | Zadanie | Plik | Opis |
|---|---------|------|------|
| 7.3.1 | Rozszerzenie `GET /sync/health` o status per-backend | `__server/src/app/api/sync/health/route.ts` | Health check kazdego storage backendu, nie tylko globalnego SFTP |

**Weryfikacja fazy 7:**
- [ ] `/sync/history` zwraca zakonczone sesje z czasem trwania
- [ ] `/sync/history/{id}` zwraca step log sesji
- [ ] `/sync/devices` zwraca liste urzadzen z aktualnym markerem
- [ ] `/sync/health` zwraca status kazdego storage backendu

---

## ZALEZNOSCI MIEDZY FAZAMI

```
FAZA 1 (czyszczenie) ─── nie zalezy od niczego, mozna zaczac natychmiast
    │
    ├──► FAZA 2 (storage backends) ─── wymaga czystego serwera
    │        │
    │        ├──► FAZA 3 (licencje) ─── wymaga storage backends (lookup group → backend)
    │        │
    │        └──► FAZA 5 (UI serwera) ─── wymaga storage backends do wyswietlenia
    │                 │
    │                 └──► FAZA 6 (async delta) ─── wymaga UI do zarzadzania
    │
    └──► FAZA 4 (stabilnosc klienta) ─── niezalezna, mozna rownolegle z faza 2
             │
             └──► FAZA 7 (endpointy) ─── niezalezna, mozna rownolegle

Rownolegle mozliwe:
  - FAZA 1 → potem FAZA 2 + FAZA 4 rownolegle
  - FAZA 5 + FAZA 7 rownolegle (po faza 2)
  - FAZA 6 jako ostatnia (wymaga fazy 2, 4, 5)
```

---

## SZACUNEK ROZMIARU

| Faza | Nowe pliki | Modyfikowane pliki | Szacunkowe linie kodu |
|------|-----------|-------------------|----------------------|
| 1. Czyszczenie | 0 | ~8 (usuwanie) | -800 (usuwanie kodu) |
| 2. Storage backends | 3-4 | 4 | +600 |
| 3. Licencje | 5 | 4 | +700 |
| 4. Stabilnosc klienta | 0-1 | 3 | +300 |
| 5. UI serwera | 4-5 | 1 | +800 |
| 6. Async delta | 3-4 (serwer) + 1-2 (klient) | 5 | +1200 |
| 7. Endpointy + historia | 4-5 | 2 | +400 |
| **Razem** | **~20-22** | **~20** | **~+3200 netto** |
