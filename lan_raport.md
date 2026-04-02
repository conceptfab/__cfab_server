# Raport: Realizacja online.md przez __client i __server

**Data analizy:** 2026-04-02
**Analizowane repozytorium:** `online.md` (spec) vs `__client/` i `__server/` (implementacja)

---

## 1. PODSUMOWANIE

| Obszar | Klient (`__client`) | Serwer (`__server`) |
|--------|---------------------|---------------------|
| **13-krokowy protokol** | ~80% | ~85% |
| **SFTP transfer** | Zaimplementowany | Zaimplementowany (sftp-manager) |
| **Szyfrowanie AES-256-GCM** | Zaimplementowane | Zaimplementowane |
| **Sesje sync** | Klient poluje poprawnie | CRUD + state machine dziala |
| **Licencje** | Brak po stronie klienta | Dane istnieja, ale nie sa egzekwowane |
| **Dashboard UI** | Kompletny (settings + progress) | N/A |
| **Merge** | Poprawnie na kliencie (MASTER) | BLAD: merge nadal tez na serwerze |
| **Push/Pull HTTP** | Stare endpointy nadal uzywane | Stare endpointy nadal istnieja |

**Ogolna ocena: ~75% implementacji spec. Krytyczne rozbieznosci istnieja.**

---

## 2. CO JEST ZAIMPLEMENTOWANE POPRAWNIE

### 2.1 Klient (Rust daemon)

- **`src/online_sync.rs` (~700 linii)** - Pelny 13-krokowy state machine:
  - Kroki 1-2: Tworzenie sesji, polling o role (MASTER/SLAVE)
  - Kroki 3-4: Negocjacja trybu, odbiór zaszyfrowanych credentiali SFTP
  - Krok 5: Freeze bazy
  - Kroki 6-7: SLAVE upload / MASTER download przez SFTP
  - Krok 8: Backup przed merge (MASTER)
  - Krok 9: Merge (last-writer-wins + tombstones)
  - Krok 10: Weryfikacja integralnosci (FK check, orphan cleanup)
  - Kroki 11-12: MASTER upload scalonej / SLAVE download scalonej
  - Krok 13: Unfreeze obu klientow

- **`src/sftp_client.rs` (146 linii)** - Klient SFTP (ssh2 crate):
  - Upload/download z progress callbackiem (64 KB chunki)
  - Limit 50 MB na download (bezpieczenstwo)
  - Zerowanie hasla w Drop (memory safety)
  - TCP timeout 30s

- **`src/sync_encryption.rs` (205 linii)** - Szyfrowanie zgodne ze spec:
  - `encrypt_file_data()`: gzip + AES-256-GCM z losowym 12-byte IV
  - `decrypt_file_data()`: AES-256-GCM + gzip decompress
  - `decrypt_credentials()`: HMAC-SHA256 key derivation dla credentiali
  - Format: [12-byte IV][ciphertext + 16-byte GCM tag]

- **`src/config.rs`** - OnlineSyncSettings zgodny ze spec:
  - enabled, server_url, auth_token, device_id, encryption_key
  - sync_interval_hours, auto_sync_on_startup
  - Zapis/odczyt z `online_sync_settings.json`

- **`src/main.rs`** - Integracja auto-startup (po 10s od startu demona)

- **`src/sync_common.rs`** - Wspolne narzedzia LAN/Online:
  - backup_database(), merge_incoming_data(), verify_merge_integrity()
  - build_full_export(), compute_tables_hash_string_conn()

### 2.2 Serwer (Next.js)

- **`src/lib/sync/session-store.ts` (560 linii)** - Zarzadzanie sesjami:
  - Atomowe tworzenie/laczenie sesji (find-join-or-create)
  - Stany: awaiting_peer, negotiating, in_progress, completed, failed, expired, cancelled
  - Logowanie krokow 1-13 z fazami (discovery, negotiation, transfer, merge, distribute)
  - TTL 30 min, heartbeat sliding window 2 min

- **`src/lib/sync/session-service.ts` (263 linii)** - Logika biznesowa sesji:
  - handleSessionCreate(), handleSessionStatus(), handleSessionReport()
  - handleSessionHeartbeat(), handleSessionCancel()
  - determineNextAction() - mapowanie krokow na akcje
  - Tworzenie katalogow SFTP i szyfrowanie credentiali przy dolaczeniu SLAVE

- **`src/lib/sync/sftp-manager.ts` (129 linii)** - Zarzadzanie SFTP:
  - Tworzenie katalogow sesji: `/{basePath}/{sessionId}/slave-upload/` i `/master-merged/`
  - Usuwanie katalogow po zakonczeniu
  - Health check SFTP

- **`src/lib/sync/storage-encryption.ts` (132 linii)** - Szyfrowanie credentiali:
  - AES-256-GCM z HMAC-SHA256 key derivation
  - Zgodne z klientem (ten sam schemat)

- **`src/lib/sync/session-cleanup.ts` (93 linii)** - Cleanup job:
  - Co 15 minut (zgodne ze spec)
  - Expiracja sesji, czyszczenie starszych niz 24h
  - Wykrywanie i usuwanie osieroconych katalogow SFTP

- **`src/lib/sync/license-*.ts`** - System licencji (~600 linii):
  - Generowanie kluczy: TF-{PLAN}-{ROK}-{SEG1}-{SEG2}-{CRC16}
  - Plany: free, starter, pro, enterprise z domyslnymi limitami
  - CRUD licencji, grup, urzadzen
  - Walidacja formatu klucza (CRC-16)

- **Endpointy sesji (zaimplementowane):**
  - `POST /sync/session/create`
  - `GET /sync/session/{id}/status`
  - `POST /sync/session/{id}/report`
  - `POST /sync/session/{id}/heartbeat`
  - `POST /sync/session/{id}/cancel`

- **Endpointy admin (zaimplementowane):**
  - CRUD licencji: POST/GET/PATCH/DELETE `/admin/license`
  - CRUD grup: POST/GET/PATCH/DELETE `/admin/group`
  - Lista urzadzen per licencja: GET `/admin/license/{id}/devices`

- **`src/lib/config/env.ts` (212 linii)** - Konfiguracja srodowiskowa:
  - SFTP_HOST, SFTP_PORT, SFTP_USER, SFTP_PASSWORD, SFTP_BASE_PATH
  - SYNC_ENCRYPTION_KEY (wymuszony w produkcji)
  - Rate limiting, CORS, retention

### 2.3 Dashboard (React/TypeScript)

- **`OnlineSyncCard.tsx` (385 linii)** - Kompletny panel ustawien:
  - Toggle wlacz/wylacz, URL serwera, token API (z show/hide)
  - Interwal sync, auto-sync on startup, logging
  - Device ID (read-only), przycisk "Synchronizuj teraz"
  - Status: rewizja serwera, hashe, pending acks

- **`SyncProgressOverlay.tsx` (165 linii)** - Wspolny overlay LAN/Online:
  - Polling co 500ms, postep krokow (np. "6/13")
  - Fazy, bajty transferu, predkosc, ETA
  - Ikony upload/download z animacjami

- **Tauri commands** (`online_sync.rs`, 118 linii) - Most dashboard-daemon:
  - get/save_online_sync_settings
  - run_online_sync (POST do demona)
  - get_online_sync_progress (GET z demona)

---

## 3. KRYTYCZNE ROZBIEZNOSCI ZE SPEC

### 3.1 SERWER NADAL PRZECHOWUJE PELNE SNAPSHOTY (NARUSZENIE SPEC)

**Spec (sekcja 2.2):** "Serwer NIE przechowuje baz danych klientow (zadnych snapshotow)"

**Stan faktyczny:** `service.ts` (611 linii) nadal:
- Przechowuje pelne archiwa w `sync-store.json` (pole `archive` z danymi)
- Retencja do 20 snapshotow per user
- `pushSnapshot()` scala dane na serwerze i zapisuje

**Wplyw:** Naruszenie modelu bezpieczenstwa - dane biznesowe sa przechowywane na serwerze, co jest sprzeczne z architektura "serwer jako posrednik".

### 3.2 MERGE NADAL DZIALA NA SERWERZE (NARUSZENIE SPEC)

**Spec (sekcja 2.2):** "Serwer NIE scala danych (merge wykonuje MASTER klient)"

**Stan faktyczny:** `service.ts` zawiera `mergeArchiveData()` i `upsertRows()` - serwer aktywnie scala dane przy push/delta-push.

**Wplyw:** Podwojna logika merge - raz na serwerze (stary flow), raz na kliencie (nowy flow). Ryzyko niespojnosci.

### 3.3 STARE ENDPOINTY HTTP PUSH/PULL NADAL ISTNIEJA

**Spec (sekcja 5.3):** Endpointy do usuniecia: `/api/sync/push`, `/api/sync/pull`, `/api/sync/delta-push`, `/api/sync/delta-pull`, `/api/sync/ack`, `/api/sync/status`

**Stan faktyczny:** Wszystkie stare endpointy nadal istnieja i sa funkcjonalne. Klient moze uzyc zarowno starego (HTTP push/pull) jak i nowego (sesja + SFTP) flow.

**Wplyw:** Dwa rownolegle dzialajace systemy sync. Potencjalne konflikty jesli klient uzyje obu.

### 3.4 LICENCJE NIE SA EGZEKWOWANE PRZY SYNC

**Spec (sekcja 14.5):** Kazde wywolanie `/sync/session/create` musi przejsc walidacje licencji (status, limity urzadzen, czestotliwosc sync, rozmiar bazy).

**Stan faktyczny:** Dane licencji istnieja w `license-store.ts`, ale:
- Brak middleware walidacji licencji na endpointach sesji
- Brak sprawdzania limitu urzadzen
- Brak rate limitingu per licencja (tylko ogolny rate limit)
- Brak sprawdzania rozmiaru bazy

**Wplyw:** Kazdy klient z ważnym tokenem moze synchronizowac bez ograniczen planu.

---

## 4. BRAKUJACE ELEMENTY

### 4.1 Serwer - brakujace endpointy

| Endpoint | Status |
|----------|--------|
| `GET /sync/history` | Nie zaimplementowany |
| `GET /sync/history/{id}` | Nie zaimplementowany |
| `GET /sync/devices` | Nie zaimplementowany (jest tylko admin) |
| `GET /sync/devices/{id}` | Nie zaimplementowany |
| `POST /license/activate` | Nie zaimplementowany (jest admin CRUD) |
| `GET /license/status` | Nie zaimplementowany |
| `POST /license/deactivate-device` | Nie zaimplementowany |
| `POST /license/refresh-token` | Nie zaimplementowany |
| `GET /sync/health` (z FTP status) | Czesciowo - SFTP health check istnieje, ale nie jest wystawiony jako endpoint |

### 4.2 Klient - brakujace funkcjonalnosci

| Funkcja | Status | Opis |
|---------|--------|------|
| **Heartbeat podczas transferu** | Brak | Spec wymaga heartbeat co 10s podczas upload/download SFTP. Obecny kod wysyla heartbeat tylko podczas `wait_for_step()`, ale NIE podczas samego transferu |
| **Retry z exponential backoff** | Brak | Spec wymaga 3 proby (5s, 15s, 45s). Klient nie ma retry |
| **Auto-unfreeze po 10 min** | Brak | Spec wymaga auto-unfreeze jesli brak odpowiedzi serwera przez 10 min. Klient uzywa stalego 5-min timeout |
| **Timeout per krok** | Brak | Spec: 10 min per krok. Klient: 5 min globalny timeout (SYNC_TIMEOUT) |
| **Timeout sesji 30 min** | Niezgodny | Spec: 30 min. Klient: 5 min (za krotki dla duzych baz) |
| **Przywracanie z backupu** | Czesciowe | Backup tworzony, ale brak automatycznego przywracania po bledzie merge |
| **Walidacja licencji offline** | Brak | Spec: regex + CRC16 checksum klucza. Klient nie waliduje |
| **Periodyczne sprawdzanie licencji** | Brak | Spec: co 24h odpytanie `/license/status` |
| **Klucz szyfrowania w UI** | Brak | Pole istnieje w typach, ale brak w formularzu OnlineSyncCard |
| **Zarzadzanie urzadzeniami** | Brak | Brak UI do listowania/usuwania sparowanych urzadzen |

### 4.3 Serwer - brakujace funkcjonalnosci

| Funkcja | Status |
|---------|--------|
| **Multi-backend storage** | Brak - tylko SFTP (spec przewiduje S3, GCS, Azure, local) |
| **Kolejka sync (SyncQueue)** | Brak - brak obslugi 3+ urzadzen z kolejkowaniem |
| **Fixed master per licencja** | Brak - role dynamiczne, brak wsparcia dla stalego mastera |
| **Historia synchronizacji** | Brak - sesje usuwane po 24h bez archiwizacji |
| **Device ID w tokenie** | Brak - token nie zawiera device_id |
| **Refresh tokeny** | Brak |
| **Per-license cleanup policies** | Brak - staly TTL 24h |
| **Czyszczenie FTP po step 13** | Czesciowe - cleanup job dziala, ale nie jest wyzwalany natychmiast po step 13 |

---

## 5. PROBLEMY LOGICZNE I ARCHITEKTONICZNE

### 5.1 Dwa rownolegle systemy sync

Serwer obsluguje jednoczesnie:
1. **Stary flow:** HTTP push/pull z merge na serwerze (snapshotowy)
2. **Nowy flow:** Sesyjny 13-krokowy z SFTP

To powoduje:
- Ryzyko uzycia niewlasciwego flow przez klienta
- Podwojne przechowywanie danych (snapshoty + sesje)
- Niespojny model bezpieczenstwa

**Rekomendacja:** Usunac stare endpointy push/pull/delta-push/delta-pull/ack/status po pelnej migracji na flow sesyjny.

### 5.2 Timeout klienta za krotki

Klient ma `SYNC_TIMEOUT = 300` sekund (5 min). Spec wymaga:
- 30 min timeout sesji
- 10 min timeout per krok
- Transfer duzej bazy (50+ MB na wolnym laczu) moze przekroczyc 5 min

**Rekomendacja:** Zwiekszyc SYNC_TIMEOUT do min. 30 min lub dodac per-step timeout.

### 5.3 Brak heartbeat podczas SFTP transferu

Podczas `sftp_client.upload_data()` / `download_data()` nie jest wysylany heartbeat do serwera. Jesli transfer trwa dluzej niz 2 min (heartbeat sliding window serwera), sesja moze wygasnac.

**Rekomendacja:** Dodac mechanizm wysylania heartbeat co 10s rownolegle z transferem SFTP (np. w osobnym watku).

### 5.4 Progress reuse LAN/Online

Klient reuzuje `LanSyncState` dla progress online sync. Nie ma dedykowanego stanu dla online sync (np. `OnlineSyncState`). Moze powodowac konflikty jesli LAN i online sync dzialaja jednoczesnie.

### 5.5 Brak walidacji licencji = brak monetyzacji

System licencji jest zaimplementowany (keygen, CRUD, plany), ale nie jest podpiety do flow sync. Kazdy klient z tokenem moze synchronizowac bez ograniczen - plany (free/starter/pro/enterprise) nie maja wplywu.

### 5.6 UI serwera (page.tsx) kompletnie nieaktualny

Dashboard serwera (`__server/src/app/page.tsx`, 583 linie) jest oparty o **stary model synchronizacji** i nie odzwierciedla nowej architektury sesyjnej z online.md.

**Co pokazuje UI (stary model):**

| Sekcja UI | Dane | Problem |
|-----------|------|---------|
| "Dane przeslane (snapshoty)" | Liczba snapshotow na serwerze | Serwer nie powinien przechowywac snapshotow (spec 2.2) |
| "Jak czytac statusy" | Opis push/pull/ack flow | Dotyczy starego modelu, nie sesyjnego 13-krokowego |
| Tabela urzadzen | Rev, Hash, ACK Rev, ACK At | Kolumny z modelu snapshotowego (revision, ack) - nie sesyjnego |
| "Payload na serwerze: jest/usuniety" | Czy archiwum jest w sync-store.json | Serwer nie powinien miec payloadu w ogole |
| "Reset historii sync" | Kasuje snapshoty, revision, ack | Operuje na starym sync-store.json |
| "Konfiguracja SFTP" | Globalne env: SFTP_HOST, PORT, USER | Powinno byc per-grupa/licencja, nie globalne |
| "Licencje i grupy klientow" | Placeholder "Wkrotce" | Admin CRUD licencji istnieje w API ale brak UI |
| "Aktywne sesje sync (Online)" | Tabela sesji | Jedyna sekcja ktora odzwierciedla nowy model |

**Co powinien pokazywac UI (nowy model):**

| Sekcja | Dane | Zrodlo |
|--------|------|--------|
| **Aktywne sesje sync** | ID, status, master/slave, krok/13, tryb, czas | session-store.json (juz istnieje) |
| **Historia synchronizacji** | Zakonczone sesje, czas trwania, marker_hash | Nowy: SyncHistoryEntry[] (do implementacji) |
| **Licencje** | Lista licencji, plan, status, max urzadzen, wygasniecie | license-store.json (dane istnieja, brak UI) |
| **Grupy klientow** | Nazwa, licencja, storage backend, fixed master, urzadzenia | license-store.json (dane istnieja, brak UI) |
| **Storage backends** | Typ (SFTP/S3), host, status polaczenia, zajete miejsce | Do implementacji (per-grupa) |
| **Urzadzenia** | Device ID, nazwa, grupa, last seen, last sync, marker | license-store.json (dane istnieja, brak UI) |
| **Health check** | Status serwera, status storage backends, aktywne sesje | Czesciowo istnieje (SFTP health) |

**Sekcje do USUNIECIA z UI:**

- "Jak czytac statusy" (opis push/pull/ack)
- "Dane przeslane (snapshoty)" / snapshotCount
- Tabela urzadzen z kolumnami Rev/ACK (stary model)
- "Payload na serwerze"
- "Reset historii sync" (operuje na sync-store.json snapshotow)

**Sekcje do DODANIA:**

- CRUD licencji (zamiast placeholdera "Wkrotce")
- CRUD grup z przypisaniem storage backendu
- CRUD storage backendow (per-grupa konfiguracja SFTP/S3)
- Lista urzadzen z informacjami z nowego modelu (group, last sync, marker)
- Historia synchronizacji (zakonczone sesje)

---

## 6. BEZPIECZENSTWO

### 6.1 Co jest dobrze

- AES-256-GCM dla plikow i credentiali (zgodne ze spec)
- HMAC-SHA256 key derivation (zgodne ze spec)
- Zerowanie hasel w pamieci (Drop trait w Rust)
- SFTP over SSH (nie plaintext FTP)
- Limit 50 MB na download (ochrona przed DoS)
- Rate limiting na serwerze

### 6.2 Potencjalne problemy

- **Serwer przechowuje dane biznesowe** - naruszenie modelu "serwer nie widzi danych"
- **Brak walidacji licencji** - brak kontroli dostepu
- **Stale endpointy push/pull** - dane biznesowe przechodzą przez HTTP serwera (nie SFTP)
- **Brak device_id w tokenie** - token nie identyfikuje urzadzenia, co utrudnia audit

---

## 7. STORAGE PER GRUPA - BRAKUJACA ARCHITEKTURA

### 7.1 Jak powinno dzialac (wg spec i wizji)

Parametry serwera storage (SFTP/S3/inne) powinny byc **przypisane do grupy**, nie globalne:

```
Admin tworzy grupe:
  1. Wybiera licencje (plan: free/starter/pro/enterprise)
  2. Ustawia parametry storage DLA TEJ GRUPY:
     - typ: SFTP / S3 / GCS / Azure / local
     - host, port, user, password (lub access keys)
     - base path
     - limity (max file size, session TTL)
  3. Klienty w tej grupie dostaja zaszyfrowane credentiale per sesja
```

Dzieki temu:
- Firma A moze miec **wlasny serwer SFTP** (dane nigdy nie opuszczaja firmy)
- Firma B moze uzyc **S3 w chmurze** (wygoda)
- Kazda grupa ma **izolowane storage** (bezpieczenstwo)

### 7.2 Obecny stan implementacji

**`ClientGroup`** ([license-contracts.ts:26-36](../__server/src/lib/sync/license-contracts.ts#L26-L36)) ma pole `storageBackendId: string`, ale:

| Element | Stan | Problem |
|---------|------|---------|
| `storageBackendId` w ClientGroup | Pole istnieje | Nigdzie nie jest uzyty - brak lookupa backendu po ID |
| `StorageBackendConfig` (typ) | **Nie istnieje** | Spec definiuje interfejs z type/host/port/user/pass/basePath - brak w kodzie |
| Registry backendow | **Nie istnieje** | Brak CRUD, brak pliku `storage-backends.ts` |
| SFTP config | Globalny z `.env` | Jeden SFTP dla calego serwera, nie per grupa |
| `AdminCreateGroupBody` | Przyjmuje `storageBackendId` | Ale nie waliduje czy backend o takim ID istnieje |
| Admin UI/endpoint dla backendow | **Nie istnieje** | Brak endpointow do zarzadzania backendami storage |

### 7.3 Co trzeba zaimplementowac

```
license-store.json (docelowo):
{
  "storageBackends": {
    "backend-1": {
      "id": "backend-1",
      "type": "sftp",
      "name": "FTP firmowy Firma-A",
      "host": "ftp.firma-a.pl",
      "port": 22,
      "protocol": "sftp",
      "username": "timeflow-sync",
      "password": "encrypted:...",
      "basePath": "/timeflow-sync/",
      "maxFileSizeMb": 100,
      "sessionTtlMinutes": 30
    },
    "backend-2": {
      "id": "backend-2",
      "type": "aws-s3",
      "name": "S3 cloud",
      "region": "eu-central-1",
      "bucket": "timeflow-sync",
      "accessKeyId": "encrypted:...",
      "secretAccessKey": "encrypted:...",
      "basePath": "sync/",
      "usePresignedUrls": true
    }
  },
  "groups": {
    "group-1": {
      "storageBackendId": "backend-1",  // <-- lookup tutaj
      ...
    }
  }
}
```

**Potrzebne zmiany:**

1. **Nowy typ `StorageBackendConfig`** w `license-contracts.ts` - interfejs bazowy + warianty (SFTP, S3, etc.)
2. **Registry backendow** w `license-store.ts` - CRUD z szyfrowaniem hasel/kluczy at rest
3. **Admin endpointy** - POST/GET/PATCH/DELETE `/admin/storage-backend`
4. **Lookup w session-service.ts** - przy tworzeniu sesji: `grupa → storageBackendId → config` zamiast globalnego `getEnv().sftpHost`
5. **Adapter pattern w sftp-manager.ts** - zamiast jednego SFTP klienta, fabryka klientow per backend type
6. **Usunac globalne SFTP_* z `.env`** - lub zostawic jako fallback/domyslny backend

### 7.4 Przeplyw docelowy

```
Klient POST /sync/session/create
  → serwer: auth → device → group → license
  → serwer: group.storageBackendId → storageBackends[id] → config
  → serwer: tworzy katalog sesji NA WLASCIWYM STORAGE (nie globalnym)
  → serwer: szyfruje credentiale TEGO storage AES-256-GCM
  → klient: dostaje zaszyfrowane credentiale przez polling /status
  → klient: laczy sie z WLASCIWYM storage (SFTP/S3/inne)
```

---

## 8. MACIERZ ZGODNOSCI ZE SPEC (PO SEKCJACH)

| Sekcja spec | Tytul | Zgodnosc | Uwagi |
|-------------|-------|----------|-------|
| 1. Koncepcja | Filozofia | 60% | Serwer nadal scala i przechowuje dane |
| 2. Rola serwera | Odpowiedzialnosci | 70% | Sesje OK, ale licencje nie egzekwowane |
| 3. Bezpieczenstwo FTP | Szyfrowanie | 90% | Szyfrowanie AES-256-GCM zgodne |
| 4. Przeplyw 13 krokow | State machine | 85% | Kroki zaimplementowane, brakuje heartbeat/retry |
| 5. Endpointy | API sesji | 75% | Sesje OK, brak history/devices/license endpoints |
| 6. Komunikacja | Polling/heartbeat | 70% | Polling OK, heartbeat niekompletny |
| 7. Zarzadzanie FTP | Cleanup | 80% | Cleanup job OK, brak natychmiastowego cleanup po step 13 |
| 8. Zmiany klient | Demon Rust | 80% | Core OK, timeout/retry/heartbeat niepelne |
| 9. Zmiany serwer | Nowe pliki | 70% | Sesje/encryption OK, brak migracji ze starych endpointow |
| 10. Dashboard | UI | 85% | Settings/progress OK, brak encryption key w UI |
| 11. Plan implementacji | Fazy 1-6 | ~75% | Fazy 1-4 czesciowo, faza 5 (migracja) nie zaczeta |
| 12. Wspolistnienie LAN/Online | Tryby | 50% | Brak kolejki, brak fixed master, brak multi-device |
| 13. Ryzyka | Mitygacja | 60% | Brak retry, heartbeat, per-step timeout |
| 14. Licencje | Serializacja | 40% | Keygen/CRUD OK, brak egzekwowania i endpointow klienckich |

---

## 9. REKOMENDACJE PRIORYTETOWE

### Priorytet 1 (krytyczne - naruszenia spec)

1. **Usunac merge z serwera** - przeniesc caly merge na klienta MASTER (juz zaimplementowany w `sync_common.rs`)
2. **Usunac przechowywanie snapshotow na serwerze** - serwer powinien przechowywac tylko metadane sesji
3. **Usunac/wylaczyc stare endpointy** push/pull/delta-push/delta-pull/ack/status
4. **Podpiac walidacje licencji** do `/sync/session/create` - sprawdzanie statusu, limitow, czestotliwosci

### Priorytet 2 (wazne - stabilnosc)

5. **Heartbeat podczas transferu SFTP** - osobny watek wysylajacy heartbeat co 10s
6. **Zwiekszyc timeout** klienta z 5 min do 30 min (lub per-step 10 min)
7. **Retry z exponential backoff** (3 proby: 5s, 15s, 45s)
8. **Auto-unfreeze** po 10 min braku odpowiedzi serwera
9. **Natychmiastowy cleanup FTP** po step 13 (nie tylko co 15 min)

### Priorytet 3 (brakujace funkcje)

10. Endpointy `/sync/history`, `/sync/devices`
11. Endpointy `/license/activate`, `/license/status`, `/license/refresh-token`
12. Kolejka sync (SyncQueue) dla 3+ urzadzen
13. Fixed master per licencja
14. Multi-backend storage (S3/GCS/Azure)
15. UI: pole encryption key, zarzadzanie urzadzeniami, historia sync

---

## 10. PROPOZYCJA: ASYNC DELTA SYNC (STORE-AND-FORWARD)

### 10.1 Koncepcja

Obecny 13-krokowy protokol wymaga **jednoczesnej obecnosci obu klientow**. W praktyce czesto jeden klient jest offline (laptop zamkniety, stanowisko wylaczone). Propozycja: tryb asynchroniczny, gdzie klient moze zostawic paczke delta na storage (FTP/S3) i drugi klient pobierze ja gdy wroci online.

### 10.2 Scenariusz podstawowy (jednokierunkowy)

```
Stan poczatkowy: A i B maja marker M1 (zsynchronizowane)

1. B idzie offline
2. A pracuje, generuje nowe dane
3. A: tworzy delta (zmiany od M1), szyfruje, uploaduje na storage
   → POST /sync/async/push { device_id, base_marker: M1, delta, new_marker: M2 }
4. Serwer: zapisuje metadane paczki (base_marker, new_marker, storage_path, ttl)
5. A: ustawia swoj marker na M2

... czas mija ...

6. B wraca online, polluje serwer (normalny cykl sync)
   → GET /sync/async/pending { device_id }
   ← { packages: [{ id, from_device, base_marker: M1, new_marker: M2, size, created_at }] }
7. B: sprawdza swoj marker — M1, zgadza sie z base paczki
8. B: pobiera z storage, deszyfruje, aplikuje delta do bazy
9. B: ustawia marker na M2
10. B: raportuje do serwera
    → POST /sync/async/ack { package_id, device_id, applied_marker: M2 }
11. Serwer: oznacza paczke jako dostarczona, czysci storage

Wynik: A=M2, B=M2 — zsynchronizowane, bez jednoczesnej obecnosci
```

### 10.3 Scenariusz dwustronny (oba klienty pracowaly offline)

```
Stan: A=M1, B=M1, oba pracuja niezaleznie

FAZA 1 — A pushuje swoje zmiany:
  A: delta_A (zmiany od M1), upload storage
  A: marker = M2 (hash bazy A po zmianach)
  Serwer: paczka { base: M1, new: M2, from: A }

FAZA 2 — B wraca, ma wlasne zmiany:
  B: widzi paczke od A (base=M1)
  B: swoj marker = M1 (zgadza sie z base)
  B: pobiera delta_A
  B: MERGUJE delta_A ze swoimi lokalnymi zmianami (last-writer-wins)
  B: generuje marker M3 (hash scalonej bazy)
  B: uploaduje delta_B (swoje zmiany ktore A nie ma) na storage
  B: raportuje { applied_marker: M3, pushed_delta: { base: M2, new: M3 } }

FAZA 3 — A pobiera zwrotna delta:
  A: polluje serwer, widzi paczke od B (base=M2, new=M3)
  A: swoj marker = M2, zgadza sie
  A: pobiera delta_B, aplikuje
  A: marker = M3

Wynik: A=M3, B=M3 — zsynchronizowane
```

### 10.4 Dlaczego to dziala dla TIMEFLOW

Dane TIMEFLOW maja wlasciwosci ktore sprawiaja ze async merge jest bezpieczny:

| Wlasciwosc | Dlaczego pomaga |
|-------------|-----------------|
| **Rekordy addytywne** | Kazde stanowisko generuje nowe rekordy z unikalnym `record_uuid` — nie koliduja |
| **Last-writer-wins** | Edycje tego samego rekordu rozwiazywane po `updated_at` — deterministyczne |
| **Tombstones addytywne** | Usuniecie zawsze wygrywa — brak konfliktu "usuniety vs edytowany" |
| **Brak relacji miedzy stanowiskami** | Stanowisko A nie edytuje rekordow stanowiska B |
| **Istniejacy merge** | `merge_incoming_data()` w `sync_common.rs` juz obsluguje ten model |

### 10.5 Porownanie z 13-krokowym protokolem

| Aspekt | 13-krokowy (sesyjny) | Async delta |
|--------|---------------------|-------------|
| Oba klienty online | WYMAGANE | NIE wymagane |
| Freeze/unfreeze bazy | TAK (krok 5, 13) | NIE — brak freeze |
| Czas synchronizacji | Minuty (real-time) | Godziny/dni (store-and-forward) |
| Zlozonosc protokolu | 13 krokow, heartbeat, timeout | 3 fazy: push → pending → apply |
| Gwarancja spojnosci | Silna (freeze blokuje zapisy) | Ewentualna (eventual consistency) |
| Ryzyko utraty danych | Minimalne (backup + freeze) | Niskie (merge last-writer-wins) |
| Ilosc transferow | 2 (slave→master, master→slave) | 1-2 (push, opcjonalnie push-back) |
| Obciazenie serwera | Wyssze (polling co 3s, heartbeat) | Niskie (polling co sync_interval) |

### 10.6 Kiedy uzyc ktorego trybu

| Sytuacja | Tryb |
|----------|------|
| Oba klienty online, potrzebna natychmiastowa sync | 13-krokowy sesyjny |
| Jedno stanowisko czesto offline | **Async delta** |
| Wielu SLAVE, jeden MASTER agregator | **Async delta** (SLAVE pushuja w swoim tempie) |
| Krytyczne dane, wymagana silna spojnosc | 13-krokowy sesyjny |
| Wolne/drogie lacze (LTE, satelita) | **Async delta** (mniejszy transfer) |
| LAN — oba urzadzenia w sieci | LAN sync (najszybszy) |

### 10.7 Model danych serwera

```typescript
interface AsyncDeltaPackage {
  id: string;                    // UUID paczki
  groupId: string;               // grupa klientow
  fromDeviceId: string;          // kto wyslal
  targetDeviceId: string | null; // null = dla wszystkich w grupie
  baseMarkerHash: string;        // marker od ktorego liczona delta
  newMarkerHash: string;         // marker po aplikacji delty
  storagePath: string;           // sciezka na storage (FTP/S3)
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;             // TTL paczki (np. 7 dni)
  status: "pending" | "delivered" | "expired" | "rejected";
  deliveredAt: string | null;
  deliveredToDeviceId: string | null;
}
```

### 10.8 Nowe endpointy

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/sync/async/push` | POST | Klient uploaduje delta na storage, serwer rejestruje paczke |
| `/sync/async/pending` | GET | Lista oczekujacych paczek dla device_id |
| `/sync/async/ack` | POST | Klient potwierdza aplikacje paczki |
| `/sync/async/reject` | POST | Klient odrzuca paczke (np. base_marker nie pasuje) |

### 10.9 Ryzyka i mitygacja

| Ryzyko | Mitygacja |
|--------|-----------|
| **base_marker nie pasuje** (B zmienil dane ale nie pushnal) | B odrzuca paczke → fallback na pelny sync (13 krokow) lub B merguje i pushuje zwrotna delta |
| **Wiele paczek w kolejce** (A pushuje 5x zanim B wrocil) | Konsolidacja: serwer laczy delta w jedna paczke, lub klient aplikuje po kolei |
| **Paczka wygasla** (B offline dluzej niz TTL) | Fallback na pelny sync; TTL konfigurowalny per plan |
| **Brak freeze = zapis w trakcie eksportu delta** | Delta liczona z kopii bazy (snapshot read); SQLite WAL mode zapewnia izolacje odczytu |
| **Rozmiar delty rosnie z czasem** | Limit rozmiaru; po przekroczeniu → fallback na pelny sync |
| **Oba pushuja jednoczesnie** | Serwer kolejkuje; drugi push dostaje info "jest juz paczka do pobrania — najpierw apply" |

### 10.10 Wplyw na istniejacy kod

| Komponent | Zmiana |
|-----------|--------|
| **Klient: `sync_common.rs`** | `build_delta_export()` — nowa funkcja eksportu tylko zmian od markera (rekordy z `updated_at > last_sync_at` + nowe tombstones) |
| **Klient: `online_sync.rs`** | Nowy tryb `AsyncDelta` obok istniejacego `Session` |
| **Klient: config** | `sync_mode: "session" \| "async" \| "auto"` — auto wybiera tryb wg dostepnosci peera |
| **Serwer: nowy modul** | `src/lib/sync/async-delta.ts` — CRUD paczek, walidacja markerow |
| **Serwer: endpointy** | `src/app/api/sync/async/` — push, pending, ack, reject |
| **Serwer: cleanup** | Rozszerzenie cleanup job o czyszczenie wygaslych paczek |
| **Dashboard** | Status "Paczka czeka na pobranie" / "Wyslano paczke, oczekuje na odbiór" |

### 10.11 Rekomendacja

Async delta sync jest **naturalnym rozszerzeniem** istniejacej architektury:
- Reuzuje istniejacy transport (storage FTP/S3), szyfrowanie (AES-256-GCM), merge (last-writer-wins)
- Nie wymaga zmian w logice merge — `merge_incoming_data()` juz obsluguje delty
- Pokrywa najczestszy przypadek uzycia (stanowiska nie zawsze online jednoczesnie)
- Moze zastapic 13-krokowy protokol jako **domyslny tryb online sync** z fallbackiem na pelny sync gdy async delta zawiedzie (base_marker mismatch, za duza delta)

Proponowany priorytet implementacji: **po naprawie krytycznych rozbieznosci (sekcja 9, priorytet 1)**, ale przed multi-backend storage i kolejka sync.

---

## 11. WNIOSKI

Implementacja realizuje **rdzen architektury online sync** opisany w `online.md`:
- 13-krokowy protokol sesyjny dziala po stronie klienta i serwera
- Transfer SFTP z szyfrowaniem AES-256-GCM jest funkcjonalny
- Dashboard UI jest kompletny (settings + progress overlay)

**Glowny problem:** Serwer nie zostal zmigrowany ze starego modelu (snapshoty + merge server-side) na nowy (tylko koordynacja). Oba systemy wspolistnieja, co jest sprzeczne ze spec i stwarza ryzyko bezpieczenstwa (dane na serwerze) oraz niespojnosci.

**Drugi problem:** System licencji jest "pustym szkieletem" - dane istnieja, ale nie wplywaja na dzialanie sync. Bez egzekwowania licencji, monetyzacja online sync nie jest mozliwa.

**Trzeci problem:** Brakuje mechanizmow odpornosci (heartbeat podczas transferu, retry, per-step timeout), co moze powodowac zawieszanie sie sync przy wolnych polaczeniach lub duzych bazach.
