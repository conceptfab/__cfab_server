# Online Sync — Architektura i Plan Implementacji

## 1. KONCEPCJA

### 1.1 Filozofia

Synchronizacja online dziala identycznie jak LAN sync (13 kroków, MASTER/SLAVE, freeze/unfreeze),
ale z dwoma kluczowymi różnicami:

1. **Serwer synchronizacji jest pośrednikiem** — nie scala danych, nie przechowuje baz.
   Jego rola: autoryzacja, rozstrzyganie ról, koordynacja procedury, logowanie.
2. **Transfer bazy odbywa się przez dedykowany serwer FTP** — serwer sync wysyła
   klientom zaszyfrowane dane dostępowe (host, port, user, pass, ścieżka).

### 1.2 Obecny stan serwera (`__server`)

| Element | Obecny stan | Docelowy stan |
|---------|-------------|---------------|
| Auth | Bearer token (`SYNC_API_TOKENS`) | Bez zmian — rozszerzyć o refresh tokeny |
| Storage | JSON file (`sync-store.json`) z pełnymi snapshotami | Tylko metadane sesji sync + logi (bez archiwów) |
| Merge | Server-side merge (`mergeArchiveData`) | **Usunąć** — merge robi MASTER klient |
| Push/Pull | Klient wysyła/odbiera bazę przez HTTP serwera | Klient wysyła/odbiera bazę przez FTP |
| Roles | Brak ról — każde urządzenie push/pull niezależnie | MASTER/SLAVE rozstrzygany przez serwer |
| Snapshots | Do 20 snapshotów per user, z pruningiem | **Usunąć** — serwer nie przechowuje baz |
| ACK | Klient potwierdza odbiór snapshotu | Klient potwierdza zakończenie każdego kroku |

### 1.3 Architektura docelowa

```
┌─────────────┐         HTTPS (koordynacja)         ┌──────────────────┐
│  Klient A   │◄───────────────────────────────────►│  Serwer Sync     │
│  (MASTER)   │                                      │  (pośrednik)     │
│             │         FTP/FTPS (transfer bazy)     │                  │
│             │◄────────────────────────────────────►│  Serwer FTP      │
└─────────────┘                                      │  (storage)       │
                                                     └──────────────────┘
┌─────────────┐         HTTPS (koordynacja)               ▲
│  Klient B   │◄──────────────────────────────────────────┤
│  (SLAVE)    │                                            │
│             │         FTP/FTPS (transfer bazy)           │
│             │◄───────────────────────────────────────────┘
└─────────────┘
```

**Klient nigdy nie łączy się bezpośrednio z drugim klientem** — cała komunikacja
przechodzi przez serwer sync (koordynacja) lub serwer FTP (dane).

---

## 2. ROLA SERWERA SYNCHRONIZACJI

### 2.1 Odpowiedzialności serwera

| Funkcja | Opis |
|---------|------|
| **Autoryzacja** | Weryfikacja tokenów, identyfikacja urządzeń, walidacja licencji, kontrola dostępu |
| **Licencje i limity** | Walidacja klucza licencyjnego, przypisanie grupy/planu, egzekwowanie limitów (storage backend, liczba urządzeń, częstotliwość sync) |
| **Rozstrzyganie MASTER/SLAVE** | Na podstawie: konfiguracji licencji (fixed master), kolejności zgłoszeń, device_id (tie-break) |
| **Zarządzanie sesjami sync** | Tworzenie sesji, śledzenie postępu (krok 1–13), timeout, anulowanie |
| **Dostarczanie danych storage** | Zaszyfrowane credentiale do backendu storage (FTP/AWS/inne) przypisanego licencji + ścieżka per sesja |
| **Logowanie operacji** | Każdy krok sync logowany z timestampem, device_id, statusem |
| **Historia synchronizacji** | Rejestr zakończonych sync (marker_hash, czas, urządzenia, tryb) |
| **Czyszczenie FTP po sync** | Po potwierdzeniu udanego procesu (oba klienty zgłosiły krok 13) serwer sam usuwa katalog sesji z FTP (kontem serwisowym). Sesje nieudane/wygasłe sprzątane przez cleanup job co 15 min |

### 2.2 Czego serwer NIE robi

- **Nie przechowuje baz danych klientów** (żadnych snapshotów)
- **Nie scala danych** (merge wykonuje MASTER klient)
- **Nie przetwarza zawartości baz** (nie parsuje archiwów)
- **Nie dotyka zawartości plików na FTP** (klienci sami uploadują/downloadują zaszyfrowane bazy; serwer zarządza tylko strukturą katalogów i cyklem życia sesji)

### 2.3 Model danych serwera

#### Sesja synchronizacji

```typescript
interface SyncSession {
  id: string;                    // UUID sesji
  userId: string;                // właściciel
  status: SyncSessionStatus;     // stan sesji
  createdAt: string;             // ISO 8601
  updatedAt: string;
  expiresAt: string;             // timeout sesji (np. +15 min)

  // Licencja
  licenseId: string;               // klucz licencji → determinuje plan i storage backend
  groupId: string;                 // grupa klientów (firma/zespół)
  storageBackend: StorageBackendType; // FTP/AWS/inne — z konfiguracji licencji

  // Urządzenia
  masterDeviceId: string;
  slaveDeviceId: string;

  // Negocjacja
  syncMode: "full" | "delta" | null;
  masterMarkerHash: string | null;
  slaveMarkerHash: string | null;

  // Storage (FTP/AWS/inne — zależne od licencji)
  storageSessionPath: string;    // unikalna ścieżka na storage dla tej sesji
  storageCredentialsSentAt: string | null;

  // Postęp (kroki 1-13)
  currentStep: number;           // 0-13
  stepLog: SyncStepLog[];

  // Wynik
  resultMarkerHash: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

type SyncSessionStatus =
  | "awaiting_peer"       // MASTER zgłosił się, czeka na SLAVE
  | "negotiating"         // oba urządzenia podłączone, uzgadnianie trybu
  | "in_progress"         // sync w toku (freeze → transfer → merge → distribute)
  | "completed"           // zakończona pomyślnie
  | "failed"              // błąd
  | "expired"             // timeout
  | "cancelled";          // anulowana przez klienta
```

#### Log kroków

```typescript
interface SyncStepLog {
  step: number;                  // 1-13
  phase: string;                 // "discovery", "negotiation", "transfer", "merge", "distribute"
  action: string;                // np. "slave_uploaded_db", "master_merged", "fk_check_passed"
  deviceId: string;              // które urządzenie zgłosiło
  timestamp: string;             // ISO 8601
  details: Record<string, any>;  // dodatkowe dane (rozmiar, hash, czas operacji)
  status: "ok" | "error" | "warning";
}
```

#### Historia synchronizacji

```typescript
interface SyncHistoryEntry {
  id: string;
  userId: string;
  sessionId: string;
  masterDeviceId: string;
  slaveDeviceId: string;
  syncMode: "full" | "delta";
  markerHash: string;            // wynikowy marker po sync
  startedAt: string;
  completedAt: string;
  durationMs: number;
  stepsCompleted: number;        // 13 = sukces
  errorMessage: string | null;
}
```

#### Konfiguracja storage (po stronie serwera)

Storage backend jest abstrakcyjny — licencja/grupa determinuje który backend jest używany:

```typescript
type StorageBackendType = "ftp" | "aws-s3" | "gcs" | "azure-blob" | "local";

// Bazowy interfejs — każdy backend implementuje
interface StorageBackendConfig {
  type: StorageBackendType;
  basePath: string;              // np. /timeflow-sync/ lub s3://bucket/prefix/
  maxFileSize: number;           // limit rozmiaru bazy (np. 100MB)
  sessionTtlMinutes: number;     // po ilu minutach czyścić pliki sesji
}

// FTP/SFTP backend
interface FtpStorageConfig extends StorageBackendConfig {
  type: "ftp";
  host: string;
  port: number;
  protocol: "ftps" | "sftp";
  rootUser: string;              // konto serwisowe
  rootPassword: string;          // encrypted at rest
}

// AWS S3 backend
interface S3StorageConfig extends StorageBackendConfig {
  type: "aws-s3";
  region: string;
  bucket: string;
  accessKeyId: string;           // encrypted at rest
  secretAccessKey: string;       // encrypted at rest
  usePresignedUrls: boolean;     // klient upload/download przez presigned URL
}

// Inne backendy analogicznie (GCS, Azure Blob, local)
```

Serwer przechowuje mapę `licenseId/groupId → StorageBackendConfig`.
Klient nie wie jaki backend jest używany — dostaje tylko zaszyfrowane credentiale/URL.

---

## 3. BEZPIECZEŃSTWO TRANSFERU FTP

### 3.1 Model bezpieczeństwa

Klienty **nigdy nie znają stałych credentiali FTP**. Serwer sync przekazuje
zaszyfrowane dane dostępowe z ograniczonym zakresem (ścieżka) per sesja:

> **Uwaga:** Dynamiczne tworzenie kont FTP per sesja jest trudne do realizacji.
> Realistyczny model: jedno konto serwisowe z dostępem do `basePath`,
> a izolacja sesji oparta na unikalnych ścieżkach katalogów + szyfrowaniu plików.
> Klienty dostają ścieżkę sesji — nawet znając credentiale, nie odczytają
> zaszyfrowanych plików innych sesji.

```
┌──────────┐  1. POST /sync/session/create    ┌──────────────┐
│ Klient A │ ─────────────────────────────────► │ Serwer Sync  │
│ (MASTER) │                                    │              │
│          │  2. Response: {                    │  Generuje:   │
│          │ ◄─────────────────────────────────  │  - session_id│
│          │     session_id,                    │  - FTP path  │
│          │     ftp_credentials (encrypted),   │  - temp creds│
│          │     ftp_path                       │              │
│          │  }                                 └──────────────┘
└──────────┘
```

### 3.2 Szyfrowanie credentiali FTP

Serwer wysyła dane FTP zaszyfrowane kluczem sesyjnym:

```typescript
interface EncryptedFtpCredentials {
  // Zaszyfrowane AES-256-GCM kluczem derywowanym z:
  // HKDF(device_auth_token + session_id + server_secret)
  encryptedPayload: string;      // base64
  iv: string;                    // base64
  tag: string;                   // base64 (GCM auth tag)
}

// Po odszyfrowaniu klient otrzymuje:
interface FtpCredentials {
  host: string;
  port: number;
  protocol: "ftps" | "sftp";
  username: string;              // jedno konto serwisowe (chroot do katalogu sesji)
  password: string;              // hasło konta serwisowego
  uploadPath: string;            // np. /timeflow-sync/session-abc123/slave-upload/
  downloadPath: string;          // np. /timeflow-sync/session-abc123/master-merged/
}
```

### 3.3 Izolacja sesji na FTP

Każda sesja sync dostaje unikalny katalog na FTP:

```
/timeflow-sync/
  └── {session_id}/
      ├── slave-upload/          # SLAVE uploaduje tu swoją bazę/deltę
      │   └── db_slave.enc       # zaszyfrowana baza
      ├── master-merged/         # MASTER uploaduje tu scaloną bazę
      │   └── db_merged.enc      # zaszyfrowana scalona baza
      └── metadata.json          # rozmiar, hash, timestamp (do weryfikacji)
```

- Klient SLAVE ma uprawnienia: write do `slave-upload/`, read z `master-merged/`
- Klient MASTER ma uprawnienia: read z `slave-upload/`, write do `master-merged/`
- Po zakończeniu sesji (lub timeout) serwer sync sam usuwa katalog sesji z FTP (łączy się kontem serwisowym)

### 3.4 Szyfrowanie plików bazy

Bazy przesyłane przez FTP są **dodatkowo szyfrowane**:

```
[SQLite DB / Delta JSON] → gzip → AES-256-GCM(session_key) → upload FTP
```

- `session_key` = HKDF(shared_secret, session_id, "file-encryption")
- Klucz generowany przez serwer sync i dystrybuowany do klientów (serwer też go zna, ale nie przechowuje po dystrybucji)
- Nawet gdyby ktoś uzyskał dostęp do FTP — pliki są bezużyteczne bez klucza

---

## 4. PRZEPŁYW SYNCHRONIZACJI (13 KROKÓW — WERSJA ONLINE)

### Porównanie z LAN sync

| Aspekt | LAN Sync | Online Sync |
|--------|----------|-------------|
| Discovery | UDP broadcast w sieci lokalnej | Klient zgłasza się do serwera HTTP |
| Role | Peer-to-peer, tie-break po device_id | Serwer rozstrzyga na podstawie kolejności + device_id |
| Komunikacja klient↔klient | HTTP bezpośrednio (port 47891) | **Brak** — przez serwer sync |
| Transfer bazy | HTTP POST/GET bezpośrednio | FTP upload/download (zaszyfrowane) |
| Koordynacja | MASTER orkiestruje przez HTTP | Serwer sync orkiestruje, klienci raportują |
| Merge | MASTER lokalnie | MASTER lokalnie (bez zmian) |
| Logowanie | Lokalne logi | Serwer loguje każdy krok |

### Przepływ krok po kroku

```
┌─────────────────────────────────────────────────────────────────────────┐
│ FAZA 1: REJESTRACJA & ROLE ASSIGNMENT (serwer rozstrzyga)              │
│                                                                         │
│ 1. Klient A → POST /sync/session/create                                │
│    { device_id, marker_hash, table_hashes }                            │
│    ← Serwer: { session_id, role: "master", status: "awaiting_peer" }   │
│    Serwer loguje: [step:1] session created, master=A, awaiting slave   │
│                                                                         │
│ 2. Klient B → POST /sync/session/create (ten sam endpoint co A)        │
│    { device_id, marker_hash, table_hashes }                            │
│    Serwer widzi, że istnieje sesja "awaiting_peer" dla tego userId     │
│    → paruje B z istniejącą sesją A                                      │
│    ← Serwer: { session_id, role: "slave", master_marker_hash }        │
│    Serwer loguje: [step:2] slave=B joined, roles assigned              │
│                                                                         │
│    Rozstrzyganie ról:                                                   │
│    - Pierwszy klient = MASTER                                           │
│    - Jeśli oba zgłoszą się "jednocześnie" → niższy device_id = MASTER  │
│    - Oba klienty dowiadują się o roli przez polling /status             │
│                                                                         │
│    Mechanizm parowania:                                                 │
│    - Oba klienty wywołują ten sam endpoint `/sync/session/create`       │
│    - Serwer: jeśli istnieje sesja "awaiting_peer" dla userId → join    │
│    - Serwer: jeśli nie istnieje → create nową sesję                    │
│    - Klienty co `sync_interval_hours` próbują create (= discovery)     │
└─────────────────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ FAZA 2: NEGOCJACJA (przez serwer)                                       │
│                                                                         │
│ 3. Serwer porównuje marker_hash obu klientów:                          │
│    - Oba identyczne → sync_mode: "delta"                                │
│    - Różne lub brak → sync_mode: "full"                                 │
│    Klienty dowiadują się o trybie przez polling GET /status:            │
│    { sync_mode, session_id, peer_device_id }                           │
│    Serwer loguje: [step:3] negotiated mode=delta/full                  │
│                                                                         │
│ 4. Serwer generuje credentiale FTP, klienty odbierają przez polling:    │
│    → Klient A (MASTER): GET /status → { ftp_creds_encrypted, paths }   │
│    → Klient B (SLAVE):  GET /status → { ftp_creds_encrypted, paths }   │
│    Serwer loguje: [step:4] ftp credentials distributed                 │
└─────────────────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ FAZA 3: FREEZE & TRANSFER (przez FTP)                                   │
│                                                                         │
│ 5. Oba klienty BLOKUJĄ zapisy do bazy (freeze)                         │
│    → Klient A: POST /sync/session/{id}/report                          │
│      { step: 5, action: "frozen", device_id: A }                       │
│    → Klient B: POST /sync/session/{id}/report                          │
│      { step: 5, action: "frozen", device_id: B }                       │
│    Serwer czeka na oba potwierdzenia przed kontynuacją                 │
│    Serwer loguje: [step:5] both devices frozen                         │
│                                                                         │
│ 6. SLAVE uploaduje bazę na FTP:                                         │
│    - Full sync: cała baza (gzip + AES-256-GCM) → /session/slave-upload/│
│    - Delta sync: rekordy od ostatniego markera + tombstones            │
│    → Klient B: POST /sync/session/{id}/report                          │
│      { step: 6, action: "uploaded", size_bytes, sha256 }               │
│    Serwer loguje: [step:6] slave uploaded db, size=X, hash=Y           │
│                                                                         │
│ 7. Serwer powiadamia MASTER że plik gotowy do pobrania:                │
│    → Klient A (polling lub callback):                                   │
│      { step: 7, slave_upload_ready: true, file_hash, file_size }       │
│    MASTER pobiera plik z FTP: /session/slave-upload/db_slave.enc       │
│    → Klient A: POST /sync/session/{id}/report                          │
│      { step: 7, action: "downloaded", verified_hash }                  │
│    Serwer loguje: [step:7] master downloaded slave db                  │
└─────────────────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ FAZA 4: MERGE & VERIFY (MASTER lokalnie, raportuje do serwera)         │
│                                                                         │
│ 8. MASTER robi BACKUP swojej bazy (przed merge)                         │
│    (SLAVE robi backup dopiero w kroku 12 — przed podmianą)             │
│    → Klient A: POST /sync/session/{id}/report                          │
│      { step: 8, action: "backup_created", backup_path }                │
│    Serwer loguje: [step:8] master backup created                       │
│                                                                         │
│ 9. MASTER scala bazę (lokalnie):                                        │
│    - Deszyfruje plik SLAVE                                              │
│    - Merge: last-writer-wins + tombstones                               │
│    - Generuje nowy marker_hash                                          │
│    → Klient A: POST /sync/session/{id}/report                          │
│      { step: 9, action: "merged", new_marker_hash, records_merged }    │
│    Serwer loguje: [step:9] master merged, marker=Z, records=N          │
│                                                                         │
│ 10. MASTER weryfikuje scalenie:                                         │
│    - FK integrity check                                                 │
│    - Orphan cleanup                                                     │
│    - Przelicza table_hashes                                             │
│    → Klient A: POST /sync/session/{id}/report                          │
│      { step: 10, action: "verified", table_hashes, orphans_removed }   │
│    Serwer loguje: [step:10] integrity verified                         │
└─────────────────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ FAZA 5: DISTRIBUTE & RESUME (przez FTP + serwer)                        │
│                                                                         │
│ 11. MASTER uploaduje scaloną bazę na FTP:                               │
│    - Szyfruje (gzip + AES-256-GCM) → /session/master-merged/           │
│    → Klient A: POST /sync/session/{id}/report                          │
│      { step: 11, action: "uploaded_merged", size_bytes, sha256 }       │
│    Serwer powiadamia SLAVE że scalona baza gotowa                      │
│    Serwer loguje: [step:11] merged db uploaded, notifying slave        │
│                                                                         │
│ 12. SLAVE pobiera scaloną bazę z FTP:                                   │
│    - SLAVE robi BACKUP swojej bazy (przed podmianą)                    │
│    - Pobiera /session/master-merged/db_merged.enc                      │
│    - Deszyfruje, weryfikuje marker_hash                                 │
│    - Podmienia swoją bazę na scaloną                                    │
│    → Klient B: POST /sync/session/{id}/report                          │
│      { step: 12, action: "applied", verified_marker_hash }             │
│    Serwer loguje: [step:12] slave applied merged db                    │
│                                                                         │
│ 13. Oba klienty ODBLOKOWUJĄ bazy:                                       │
│    → Klient A: POST /sync/session/{id}/report                          │
│      { step: 13, action: "unfrozen", final_marker_hash }               │
│    → Klient B: POST /sync/session/{id}/report                          │
│      { step: 13, action: "unfrozen", final_marker_hash }               │
│    Serwer:                                                              │
│    - Weryfikuje że oba marker_hash są identyczne                       │
│    - Zapisuje do historii synchronizacji                                │
│    - Usuwa katalog sesji z FTP (serwer ma konto serwisowe)                              │
│    - Zamyka sesję (status: "completed")                                 │
│    Serwer loguje: [step:13] sync completed, markers match              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. ENDPOINTY SERWERA SYNCHRONIZACJI (NOWE)

### 5.1 Endpointy sesji sync

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/sync/session/create` | POST | Klient zgłasza gotowość do sync (serwer tworzy sesję lub paruje z istniejącą) |
| `/sync/session/{id}/status` | GET | Stan sesji (polling przez klientów) |
| `/sync/session/{id}/report` | POST | Klient raportuje zakończenie kroku |
| `/sync/session/{id}/heartbeat` | POST | Heartbeat z postępem transferu (co 10s, przesuwa timeout) |
| `/sync/session/{id}/cancel` | POST | Anulowanie sesji |

### 5.2 Endpointy administracyjne

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/sync/history` | GET | Historia synchronizacji (per user) |
| `/sync/history/{id}` | GET | Szczegóły sesji (logi kroków) |
| `/sync/devices` | GET | Lista urządzeń użytkownika |
| `/sync/devices/{id}` | GET | Szczegóły urządzenia (ostatni marker, status) |

### 5.3 Endpointy do usunięcia (obecne)

| Endpoint | Powód usunięcia |
|----------|-----------------|
| `/api/sync/push` | Serwer nie przechowuje snapshotów |
| `/api/sync/pull` | Transfer przez FTP, nie HTTP |
| `/api/sync/delta-push` | j.w. |
| `/api/sync/delta-pull` | j.w. |
| `/api/sync/ack` | Zastąpiony przez `/sync/session/{id}/report` |
| `/api/sync/status` | Zastąpiony przez `/sync/session/{id}/status` |

### 5.4 Endpointy zachowane (z modyfikacją)

| Endpoint | Modyfikacja |
|----------|-------------|
| `/api/health` | Bez zmian |
| Auth (Bearer token) | Bez zmian — rozszerzyć o device_id w tokenie |

---

## 6. KOMUNIKACJA KLIENT → SERWER

### 6.1 Model komunikacji: Polling

Klienty odpytują serwer o stan sesji co 2-5 sekund:

```
GET /sync/session/{id}/status
Authorization: Bearer {token}

Response: {
  status: "in_progress",
  currentStep: 7,
  myRole: "master",
  peerReady: true,
  nextAction: "download_slave_db",   // co klient powinien teraz zrobić
  ftpCredentials: { ... } | null,    // zaszyfrowane, jeśli jeszcze nie wysłane
  slaveUploadHash: "abc123...",      // hash pliku SLAVE (gdy gotowy do pobrania)
  masterMergedHash: null,            // hash scalonej bazy (gdy gotowa)
  expiresAt: "2026-03-30T15:30:00Z"
}
```

### 6.2 Heartbeat podczas transferu

Przy długich transferach (upload/download) klient wysyła heartbeat co 10s,
żeby serwer wiedział że sesja żyje i nie odpalił timeoutu:

```
POST /sync/session/{id}/heartbeat
Authorization: Bearer {token}

{
  deviceId: "device-abc",
  currentStep: 6,
  transferProgress: {
    bytesTransferred: 8500000,
    bytesTotal: 18500000,
    percentComplete: 46
  }
}

Response: { ok: true, sessionStatus: "in_progress" }
```

Serwer przy każdym heartbeat przesuwa `expiresAt` sesji (sliding window).
Jeśli heartbeat przestaje przychodzić → timeout po 2 minutach bez heartbeat.

### 6.3 Raportowanie kroków

```
POST /sync/session/{id}/report
Authorization: Bearer {token}
Content-Type: application/json

{
  step: 9,
  action: "merged",
  deviceId: "device-abc",
  details: {
    newMarkerHash: "sha256...",
    recordsMerged: 142,
    orphansRemoved: 3,
    durationMs: 2340
  },
  status: "ok"
}

Response: {
  acknowledged: true,
  nextStep: 10,
  nextAction: "verify_integrity"
}
```

### 6.3 Obsługa błędów i timeout

- **Timeout sesji:** 30 minut od utworzenia (konfigurowalny — musi pokryć pełny cykl na wolnym łączu)
- **Timeout kroku:** 10 minut na pojedynczy krok (transfer dużej bazy może trwać)
- **Retry klienta:** 3 próby z exponential backoff (5s, 15s, 45s)
- **Auto-unfreeze:** Klient automatycznie odblokuje bazę jeśli:
  - Sesja wygasła (timeout)
  - Serwer zwrócił `status: "expired"` lub `"failed"`
  - Brak odpowiedzi serwera przez 10 minut (musi być >= timeout kroku)

```
Klient wykrywa błąd/timeout:
  1. POST /sync/session/{id}/report { action: "error", details: { message } }
  2. Unfreeze lokalnej bazy
  3. Przywrócenie z backupu (jeśli merge w toku)
  4. Ikona tray → Normal
```

---

## 7. ZARZĄDZANIE FTP PRZEZ SERWER

### 7.1 Cykl życia katalogu sesji

```
1. Sesja utworzona → serwer tworzy katalog /timeflow-sync/{session_id}/
2. Credentiale wygenerowane → ograniczone do katalogu sesji
3. Transfer zakończony → pliki obecne na FTP
4. Sesja completed/failed/expired → serwer sam usuwa katalog z FTP
5. Cleanup job → kasuje katalog sesji z FTP
```

### 7.2 Konfiguracja FTP (env serwera)

```env
# FTP Server
FTP_HOST=ftp.example.com
FTP_PORT=22
FTP_PROTOCOL=sftp
FTP_ROOT_USER=timeflow-sync-service
FTP_ROOT_PASSWORD=encrypted:...
FTP_BASE_PATH=/timeflow-sync/
FTP_MAX_FILE_SIZE_MB=100
FTP_SESSION_TTL_MINUTES=30

# Encryption
SYNC_ENCRYPTION_KEY=base64:...       # klucz do szyfrowania credentiali FTP
SYNC_SESSION_KEY_SALT=base64:...     # sól do derywacji kluczy sesyjnych
```

### 7.3 Health check FTP

Serwer cyklicznie (co 5 minut) sprawdza stan serwera FTP:

```typescript
interface FtpHealthStatus {
  available: boolean;            // czy FTP odpowiada
  lastCheckAt: string;           // ISO 8601
  diskFreeBytes: number | null;  // wolne miejsce (jeśli protokół wspiera)
  diskUsedBytes: number | null;  // zajęte przez /timeflow-sync/
  activeSessions: number;        // ile katalogów sesji istnieje
  orphanedDirs: number;          // katalogi bez powiązanej sesji
  latencyMs: number;             // czas odpowiedzi
  error: string | null;          // ostatni błąd (jeśli był)
}
```

**Sprawdzane warunki i reakcje:**

| Warunek | Akcja serwera |
|---------|---------------|
| FTP niedostępny (connect timeout) | Log error, status endpoint zwraca `ftp_unavailable`, blokuje tworzenie nowych sesji |
| Wolne miejsce < próg (np. 500MB) | Log warning, endpoint `/sync/health` sygnalizuje `ftp_low_disk` |
| Wolne miejsce < próg krytyczny (np. 100MB) | Log error, blokuje nowe sesje, wymusza cleanup starych |
| Osieroconе katalogi (brak sesji w store) | Automatyczne usunięcie + log warning |
| Latency > 5s | Log warning, sygnalizacja w health check |
| Błąd autoryzacji FTP | Log critical, blokuje wszystkie operacje sync, alert |

**Endpoint health:**

```
GET /sync/health

Response: {
  server: "ok",
  ftp: {
    status: "ok" | "degraded" | "unavailable",
    lastCheck: "2026-03-30T14:00:00Z",
    diskFreeBytes: 5368709120,
    activeSessions: 2,
    error: null
  }
}
```

Klienty przed rozpoczęciem sync odpytują `/sync/health` — jeśli `ftp.status != "ok"`,
sync nie startuje i klient dostaje czytelny komunikat o przyczynie.

### 7.4 Cleanup job

Serwer uruchamia cykliczne czyszczenie (co 15 minut):

1. Znajdź sesje ze statusem `completed`, `failed`, `expired`, `cancelled`
2. Dla każdej: usuń katalog z FTP
3. Sesje starsze niż 24h z dowolnym statusem → wymuś cleanup + zamknij
4. Usuń osierocone katalogi FTP (wykryte przez health check)

---

## 8. ZMIANY W KLIENCIE (DEMON RUST)

### 8.1 Nowy moduł: `src/online_sync.rs`

Orkiestrator online sync — odpowiednik `lan_sync_orchestrator.rs` ale z HTTP/FTP:

```rust
enum OnlineSyncPhase {
    Idle,
    CreatingSession,        // krok 1: POST /sync/session/create
    AwaitingPeer,           // krok 2: polling /sync/session/{id}/status
    Negotiating,            // krok 3-4: serwer rozstrzyga
    Freezing,               // krok 5: freeze + raport
    SlaveUploading,         // krok 6: SLAVE → FTP upload
    MasterDownloading,      // krok 7: MASTER ← FTP download
    BackingUp,              // krok 8: backup
    Merging,                // krok 9: merge (MASTER)
    Verifying,              // krok 10: FK check
    MasterUploading,        // krok 11: MASTER → FTP upload merged
    SlaveDownloading,       // krok 12: SLAVE ← FTP download merged
    Unfreezing,             // krok 13: unfreeze + raport
    Completed,
    Error(String),
}
```

### 8.2 Klient FTP w demonie

Nowa zależność Rust: `ssh2` (SFTP) lub `suppaftp` (FTP/FTPS):

```rust
struct FtpClient {
    host: String,
    port: u16,
    username: String,
    password: String,
}

impl FtpClient {
    fn upload(&self, local_path: &Path, remote_path: &str) -> Result<()>;
    fn download(&self, remote_path: &str, local_path: &Path) -> Result<()>;
}
```

### 8.3 Szyfrowanie/deszyfrowanie pliku bazy

```rust
fn encrypt_database(db_path: &Path, session_key: &[u8]) -> Result<Vec<u8>> {
    // 1. Czytaj plik bazy
    // 2. gzip compress
    // 3. AES-256-GCM encrypt z session_key
    // 4. Zwróć zaszyfrowane bajty
}

fn decrypt_database(encrypted: &[u8], session_key: &[u8]) -> Result<Vec<u8>> {
    // 1. AES-256-GCM decrypt
    // 2. gzip decompress
    // 3. Zwróć surowe bajty SQLite
}
```

### 8.4 Konfiguracja klienta

Rozszerzenie `config.rs`:

```rust
pub struct OnlineSyncSettings {
    pub enabled: bool,
    pub server_url: String,           // np. https://sync.timeflow.app
    pub license_key: String,          // klucz licencji (serializacja klienta)
    pub auth_token: String,           // Bearer token (wydawany po walidacji licencji)
    pub device_id: String,            // unikalny ID urządzenia
    pub sync_interval_hours: u32,     // 0 = tylko manualnie
    pub auto_sync_on_startup: bool,   // sync przy starcie demona
}
```

---

## 9. ZMIANY W SERWERZE (`__server`)

### 9.1 Nowe pliki

| Plik | Opis |
|------|------|
| `src/lib/sync/session.ts` | Logika sesji sync (CRUD, state machine) |
| `src/lib/sync/roles.ts` | Rozstrzyganie MASTER/SLAVE (z uwzględnieniem fixed master) |
| `src/lib/sync/storage-backends.ts` | Registry backendów storage (FTP/S3/inne) + generowanie credentiali |
| `src/lib/sync/encryption.ts` | Szyfrowanie credentiali storage dla klientów |
| `src/lib/sync/cleanup.ts` | Job czyszczący stare sesje + pliki na storage |
| `src/lib/sync/history.ts` | Rejestr historii synchronizacji |
| `src/lib/sync/license.ts` | Model licencji, grup, urządzeń |
| `src/lib/sync/license-store.ts` | CRUD licencji + walidacja |
| `src/lib/sync/license-middleware.ts` | Middleware walidacji licencji na endpointach sync |
| `src/lib/sync/license-keygen.ts` | Generowanie kluczy licencji (admin tool) |
| `src/lib/sync/queue.ts` | Kolejka synchronizacji (pending devices, auto-parowanie) |
| `src/app/api/sync/session/` | Endpointy sesji (create, status, report, cancel) |
| `src/app/api/sync/history/` | Endpointy historii |
| `src/app/api/license/` | Endpointy licencji (activate, status, deactivate-device, refresh-token) |

### 9.2 Pliki do modyfikacji

| Plik | Zmiana |
|------|--------|
| `src/lib/sync/contracts.ts` | Nowe typy: SyncSession, SyncStepLog, StorageCredentials, License, ClientGroup |
| `src/lib/sync/repository.ts` | Zamiana snapshot storage na session + license storage |
| `src/lib/config/env.ts` | Nowe zmienne storage backends + encryption + domyślne limity planów |
| `src/lib/sync/http.ts` | Nowe route specs dla session + license endpoints |

### 9.3 Pliki do usunięcia/wycofania

| Plik | Powód |
|------|-------|
| `src/lib/sync/merge.ts` | Merge przeniesiony na klienta |
| `src/app/api/sync/push/` | Zastąpiony przez session flow |
| `src/app/api/sync/pull/` | j.w. |
| `src/app/api/sync/delta-push/` | j.w. |
| `src/app/api/sync/delta-pull/` | j.w. |
| `src/app/api/sync/ack/` | Zastąpiony przez /session/{id}/report |

### 9.4 Storage

Przejście z `sync-store.json` (snapshoty) na nowy format:

```typescript
interface OnlineSyncStore {
  version: 3;
  licenses: Record<string, License>;          // licenseId → License
  groups: Record<string, ClientGroup>;         // groupId → ClientGroup
  storageBackends: Record<string, StorageBackendConfig>;  // backendId → config
  syncQueues: Record<string, SyncQueue>;       // groupId → kolejka
  users: Record<string, {
    devices: Record<string, DeviceRegistration>;
    activeSessions: SyncSession[];
    history: SyncHistoryEntry[];               // limit wg planu (7–bez limitu dni)
  }>;
}
```

Docelowo: migracja na PostgreSQL (Prisma już skonfigurowany).

---

## 10. ZMIANY W DASHBOARD (FRONTEND)

### 10.1 Nowa karta ustawień: OnlineSyncCard

Rozszerzenie Settings o konfigurację synchronizacji online:

- Toggle: "Synchronizacja online"
- Input: URL serwera synchronizacji
- Input: Token autoryzacji
- Select: Interwał synchronizacji (jak LAN)
- Checkbox: "Synchronizuj przy starcie"
- Przycisk: "Synchronizuj teraz"
- Status: Ostatnia synchronizacja, marker, urządzenie peer

### 10.2 Overlay synchronizacji i progress transferu

Wspólny komponent dla LAN i Online sync:

- "Synchronizacja online w toku... (krok 7/13: Pobieranie bazy)"
- **Progress bar transferu** — wizualizacja upload/download bazy
- Przycisk "Anuluj"

**Progress bar — źródło danych:**

Demon raportuje postęp transferu do dashboardu przez istniejący mechanizm IPC (Tauri events):

```typescript
interface TransferProgress {
  direction: "upload" | "download";
  phase: string;                     // np. "Wysyłanie bazy SLAVE", "Pobieranie scalonej bazy"
  bytesTransferred: number;
  bytesTotal: number;                // znany z metadata.json lub Content-Length
  percentComplete: number;           // 0-100
  speedBytesPerSec: number;          // aktualna prędkość
  estimatedSecondsLeft: number;      // ETA
}
```

**Wizualizacja w UI:**

```
┌─────────────────────────────────────────────────────┐
│  ⟳ Synchronizacja online (krok 7/13)                │
│                                                      │
│  Pobieranie bazy od SLAVE...                         │
│  ████████████████░░░░░░░░  67%   12.4 MB / 18.5 MB │
│  ↓ 2.1 MB/s  ·  ok. 3 sek. pozostało               │
│                                                      │
│  [Anuluj]                                            │
└─────────────────────────────────────────────────────┘
```

**Stany progress bara:**

| Stan | Wizualizacja |
|------|-------------|
| Oczekiwanie na peera | Spinner + "Oczekiwanie na drugie urządzenie..." |
| Freeze | Krótki flash "Blokowanie bazy..." (szybki krok) |
| Upload SLAVE → storage | Progress bar ↑ z prędkością i ETA |
| Download MASTER ← storage | Progress bar ↓ z prędkością i ETA |
| Merge/weryfikacja | Spinner + "Scalanie danych..." (brak %, operacja lokalna) |
| Upload merged → storage | Progress bar ↑ |
| Download merged ← storage | Progress bar ↓ |
| Zakończone | ✓ "Zsynchronizowano z [nazwa_urządzenia]" (toast, znika po 5s) |
| Błąd | ✗ "Błąd synchronizacji: [opis]" + przycisk "Przywróć backup" |

**Implementacja po stronie demona (Rust):**

Klient FTP/S3 raportuje postęp przez callback:

```rust
trait StorageTransport {
    fn upload_with_progress(
        &self,
        local_path: &Path,
        session_key: &[u8],
        on_progress: impl Fn(u64, u64) + Send,  // (transferred, total)
    ) -> Result<String>;

    fn download_with_progress(
        &self,
        target_path: &Path,
        session_key: &[u8],
        on_progress: impl Fn(u64, u64) + Send,
    ) -> Result<()>;
}
```

Demon emituje `TransferProgress` do dashboardu co ~500ms (throttled, by nie zalewać UI).

### 10.3 Historia synchronizacji

Nowa zakładka/sekcja w Settings lub Data:

- Lista ostatnich synchronizacji (data, tryb, urządzenie, czas trwania, status)
- Szczegóły sesji (log kroków)

---

## 11. PLAN IMPLEMENTACJI

### Faza 1: Serwer — nowa architektura sesji

| # | Zadanie | Pliki |
|---|---------|-------|
| 1.1 | Nowe typy: SyncSession, SyncStepLog, FtpCredentials | `contracts.ts` |
| 1.2 | Session repository (CRUD, state machine) | `session.ts`, `repository.ts` |
| 1.3 | Rozstrzyganie ról MASTER/SLAVE | `roles.ts` |
| 1.4 | Endpointy: create, join, status, report, cancel | `src/app/api/sync/session/` |
| 1.5 | Logowanie kroków sync | `history.ts` |

### Faza 2: Serwer — FTP management

| # | Zadanie | Pliki |
|---|---------|-------|
| 2.1 | FTP manager — tworzenie/czyszczenie katalogów | `ftp-manager.ts` |
| 2.2 | Generowanie jednorazowych credentiali FTP | `ftp-manager.ts` |
| 2.3 | Szyfrowanie credentiali AES-256-GCM | `encryption.ts` |
| 2.4 | Cleanup job — cykliczne czyszczenie | `cleanup.ts` |
| 2.5 | Konfiguracja FTP (env) | `env.ts` |

### Faza 3: Klient — orkiestrator online sync

| # | Zadanie | Pliki |
|---|---------|-------|
| 3.1 | Klient HTTP do serwera sync (create/join/report/status) | `src/online_sync.rs` |
| 3.2 | Klient FTP/SFTP (upload/download) | `src/online_sync.rs` lub nowy `src/ftp_client.rs` |
| 3.3 | Szyfrowanie/deszyfrowanie bazy (AES-256-GCM) | `src/online_sync.rs` |
| 3.4 | State machine (13 kroków, wersja online) | `src/online_sync.rs` |
| 3.5 | Konfiguracja online sync w `config.rs` | `src/config.rs` |
| 3.6 | Integracja z `main.rs` (start, harmonogram) | `src/main.rs` |

### Faza 4: Klient — dashboard UI

| # | Zadanie | Pliki |
|---|---------|-------|
| 4.1 | OnlineSyncCard w Settings | `components/settings/OnlineSyncCard.tsx` |
| 4.2 | Tauri commands (konfiguracja, trigger sync) | `commands/online_sync.rs` |
| 4.3 | Overlay synchronizacji (wspólny LAN/Online) | `components/sync/` |
| 4.4 | Historia synchronizacji | `pages/Settings.tsx` lub `pages/Data.tsx` |
| 4.5 | Help.tsx — opis online sync | `pages/Help.tsx` |

### Faza 5: Migracja serwera

| # | Zadanie | Pliki |
|---|---------|-------|
| 5.1 | Usunięcie starych endpointów (push/pull/ack) | `src/app/api/sync/` |
| 5.2 | Usunięcie merge server-side | `merge.ts` |
| 5.3 | Migracja storage na nowy format (v3) | `repository.ts` |
| 5.4 | Dashboard serwera — nowy widok sesji | `src/app/page.tsx` |

### Faza 6: Testy i hardening

| # | Zadanie |
|---|---------|
| 6.1 | Test: pełny cykl sync online (2 klienty, serwer, FTP) |
| 6.2 | Test: timeout sesji → auto-unfreeze + cleanup |
| 6.3 | Test: błąd FTP w trakcie transferu → retry + rollback |
| 6.4 | Test: szyfrowanie/deszyfrowanie credentiali i plików |
| 6.5 | Test: jednoczesne sesje różnych userów (izolacja) |
| 6.6 | Test: cleanup job — czyszczenie starych sesji |

---

## 12. WSPÓŁISTNIENIE LAN I ONLINE SYNC

### 12.1 Założenia biznesowe

| Cecha | LAN Sync (darmowa) | Online Sync (płatna) |
|-------|-------------------|---------------------|
| Liczba maszyn | **Dokładnie 2** (stałe ograniczenie) | 2+ (wg planu licencji) |
| Model ról | Dynamiczny MASTER/SLAVE | Fixed MASTER (agregator) + wielu SLAVE |
| Transfer | Bezpośredni HTTP w sieci lokalnej | Przez konfigurowalny storage (FTP/S3/inne) |
| Dane | Pozostają w sieci lokalnej | Pozostają w firmie (własny FTP) lub w chmurze |
| Koszt | Wliczony w produkt | Abonament per plan |

**Kluczowe założenie:** LAN sync jest funkcją bazową dla 2 maszyn. Online sync to rozszerzenie
komercyjne, które umożliwia agregację danych z wielu stanowisk przez dedykowanego MASTER klienta.

### 12.2 Tryby pracy

Klient może mieć włączoną synchronizację LAN, online, lub obie:

| Scenariusz | Zachowanie |
|------------|-----------|
| Tylko LAN | Darmowa, max 2 maszyny, UDP discovery, bezpośredni transfer |
| Tylko Online | Płatna, rejestracja na serwerze, transfer przez storage backend |
| LAN + Online | LAN ma priorytet (szybszy, 2 maszyny). Online rozszerza o kolejne urządzenia |

### 12.3 MASTER jako agregator danych (online, 3+ urządzeń)

W modelu online z wieloma klientami pojawia się rola **klienta MASTER-agregator**:

```
┌──────────┐
│ SLAVE 1  │──┐
│ (stanow.)│  │
└──────────┘  │    ┌──────────────┐         ┌─────────────┐
              ├───►│ Serwer Sync  │◄───────►│ MASTER      │
┌──────────┐  │    │ (koordynator)│         │ (agregator) │
│ SLAVE 2  │──┤    └──────────────┘         │             │
│ (stanow.)│  │           ▲                 │ Zbiera dane │
└──────────┘  │           │                 │ od wszystkich│
              │    ┌──────┴───────┐         │ SLAVE i     │
┌──────────┐  │    │ Storage      │         │ scala w     │
│ SLAVE 3  │──┘    │ (FTP firmy)  │◄───────►│ jedną bazę  │
│ (stanow.)│       └──────────────┘         └─────────────┘
└──────────┘
```

**Jak działa agregacja:**

1. MASTER jest **stałym fixed master** (skonfigurowany w licencji)
2. Serwer sync zarządza **kolejką** — SLAVE zgłaszają się, czekają na swoją kolej
3. MASTER synchronizuje się z każdym SLAVE po kolei (parami, jak w LAN):
   - SLAVE wysyła swoją bazę/deltę → storage
   - MASTER pobiera, scala (merge), weryfikuje
   - MASTER wysyła scaloną bazę → storage
   - SLAVE pobiera scaloną bazę
4. Po przejściu całej kolejki MASTER ma **zagregowaną bazę ze wszystkich stanowisk**
5. Każdy SLAVE po sync też ma pełną zagregowaną bazę (widzi dane kolegów)

**Kolejność synchronizacji:**

```typescript
interface SyncQueue {
  groupId: string;
  fixedMasterDeviceId: string;       // ZAWSZE ten sam master
  activeSession: SyncSession | null;
  pendingDevices: {
    deviceId: string;
    requestedAt: string;
    priority: number;                // kolejność zgłoszeń lub ręczna konfiguracja
  }[];
  completedInCurrentRound: string[]; // SLAVE zsynchronizowani w tej rundzie
  roundStartedAt: string | null;     // kiedy zaczęła się bieżąca runda
}
```

Serwer po zakończeniu sesji MASTER↔SLAVE_N:
1. Oznacza SLAVE_N jako zsynchronizowany w tej rundzie
2. Sprawdza kolejkę — czy jest następny SLAVE?
3. Tak → startuje sesję MASTER↔SLAVE_N+1
4. Nie → runda zakończona, czeka na następny interwał

**Jeśli fixed master jest offline:**
- Sync nie startuje — SLAVE czekają w kolejce
- Serwer nie przyznaje roli mastera innemu urządzeniu (w odróżnieniu od LAN)
- Po powrocie mastera → automatycznie rozpoczyna obsługę kolejki

### 12.4 Dane pozostają w firmie — własny storage

Dzięki konfigurowalnym backendom storage (sekcja 14.8) firma może wskazać **własny serwer FTP/SFTP** jako miejsce transferu baz:

```
┌─────────────────────────────────────────────────────┐
│ SIEĆ FIRMOWA                                         │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ SLAVE 1  │  │ SLAVE 2  │  │ MASTER (agregat.)│   │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│       │              │                 │              │
│       └──────────────┼─────────────────┘              │
│                      │                                │
│               ┌──────┴──────┐                         │
│               │ FTP firmowy │  ← dane NIGDY nie       │
│               │ (on-premise)│     opuszczają firmy    │
│               └─────────────┘                         │
│                                                       │
└─────────────────────────────────────────────────────┘
                       │
            tylko HTTPS (koordynacja,
            metadane, logi — BEZ baz)
                       │
                ┌──────┴──────┐
                │ Serwer Sync │  ← zewnętrzny, ale
                │ (chmura)    │     nie widzi danych
                └─────────────┘
```

**Model bezpieczeństwa danych:**

| Co | Gdzie |
|----|-------|
| Bazy danych klientów (zaszyfrowane) | Storage firmowy (FTP/NAS) — nigdy nie opuszczają sieci |
| Koordynacja sync (metadane sesji) | Serwer sync (chmura) — nie zawiera danych biznesowych |
| Logi sync (krok, czas, status) | Serwer sync (chmura) — bez zawartości baz |
| Klucze szyfrowania plików | Tylko w pamięci klientów na czas sesji — serwer sync kasuje po dystrybucji |

To umożliwia wdrożenie w firmach z restrykcyjną polityką bezpieczeństwa danych (GDPR, ISO 27001, regulacje branżowe) — serwer sync w chmurze pełni rolę koordynatora, ale nigdy nie ma dostępu do danych biznesowych.

### 12.5 Wspólne komponenty

Merge, backup, freeze/unfreeze, FK check, marker — identyczna logika.
Różnica tylko w transporcie (HTTP bezpośredni vs serwer+FTP) i discovery (UDP vs HTTP).

```rust
// Wspólny trait dla obu trybów sync
trait SyncTransport {
    fn send_database(&self, db_path: &Path) -> Result<()>;
    fn receive_database(&self, target_path: &Path) -> Result<()>;
    fn report_step(&self, step: u32, action: &str, details: &str) -> Result<()>;
}

struct LanTransport { peer_addr: SocketAddr }
struct OnlineTransport { server_url: String, ftp_creds: FtpCredentials, session_id: String }
```

---

## 13. RYZYKA I MITYGACJA

| Ryzyko | Prawdopodobieństwo | Mitygacja |
|--------|-------------------|-----------|
| Serwer FTP niedostępny | Średnie | Retry z backoff, fallback na następny interwał |
| Wyciek credentiali FTP | Niskie | Jednorazowe per sesja, szyfrowanie AES-256-GCM, krótki TTL |
| Timeout transferu dużej bazy | Średnie | Chunked upload, konfigurowalny limit rozmiaru |
| Serwer sync pada w trakcie sesji | Niskie | Auto-unfreeze klienta po 5 min, backup pozwala rollback |
| Split brain (2 MASTERY) | Bardzo niskie | Serwer centralnie rozstrzyga role — jedno źródło prawdy |
| Klient traci połączenie w trakcie merge | Niskie | Merge lokalny (nie zależy od sieci), backup przed merge |
| FTP pełny (brak miejsca) | Niskie | Cleanup job + limit rozmiaru pliku + monitoring |
| Man-in-the-middle na FTP | Niskie | SFTP/FTPS + szyfrowanie plików + szyfrowanie credentiali |
| Wygasła/nieważna licencja | Średnie | Serwer blokuje create session, klient dostaje czytelny komunikat z linkiem do odnowienia |
| Przekroczony limit urządzeń | Niskie | Serwer odmawia rejestracji nowego device, istniejące urządzenia dalej działają |

---

## 14. LICENCJE I SERIALIZACJA KLIENTÓW

### 14.1 Koncepcja

Każdy klient TIMEFLOW posiada **unikalny klucz licencji** (`license_key`), który:
- Identyfikuje klienta i przypisuje go do **grupy** (firma/zespół/użytkownik solo)
- Determinuje **plan** (limity, backend storage, funkcje)
- Pozwala serwerowi **egzekwować** ograniczenia i rozliczać użycie
- W przyszłości: warunkuje dostęp do płatnej usługi synchronizacji

### 14.2 Model danych

#### Licencja

```typescript
interface License {
  id: string;                        // UUID
  licenseKey: string;                // np. "TF-PRO-2026-XXXX-XXXX-XXXX"
  groupId: string;                   // grupa klientów (firma/zespół)
  plan: LicensePlan;                 // plan taryfowy
  status: LicenseStatus;
  createdAt: string;
  expiresAt: string | null;          // null = bezterminowa
  maxDevices: number;                // max urządzeń w grupie
  activeDevices: string[];           // lista zarejestrowanych device_id
}

type LicenseStatus =
  | "active"                         // działa
  | "trial"                          // okres próbny
  | "expired"                        // wygasła — sync zablokowany, dane nienaruszone
  | "suspended"                      // zawieszona (np. brak płatności)
  | "revoked";                       // cofnięta

type LicensePlan = "free" | "starter" | "pro" | "enterprise";
```

#### Grupa klientów

```typescript
interface ClientGroup {
  id: string;                        // UUID
  name: string;                      // np. "Firma XYZ"
  ownerId: string;                   // userId właściciela grupy
  licenseId: string;
  storageBackendId: string;          // przypisany backend storage

  // Polityka ról
  fixedMasterDeviceId: string | null; // null = dynamiczne rozstrzyganie
  syncPriority: Record<string, number>; // device_id → priorytet w kolejce

  // Limity (nadpisują domyślne z planu)
  maxSyncFrequencyHours: number | null; // null = z planu
  maxDatabaseSizeMb: number | null;
}
```

#### Urządzenie (rozszerzenie istniejącego DeviceInfo)

```typescript
interface DeviceRegistration {
  deviceId: string;                  // unikalny ID urządzenia (generowany przy pierwszym uruchomieniu)
  groupId: string;
  licenseId: string;
  deviceName: string;                // np. "Laptop biurowy"
  registeredAt: string;
  lastSeenAt: string;
  lastSyncAt: string | null;
  lastMarkerHash: string | null;
  isFixedMaster: boolean;            // czy to urządzenie jest stałym masterem
}
```

### 14.3 Plany i limity

| Cecha | free | starter | pro | enterprise |
|-------|------|---------|-----|------------|
| Max urządzeń | 2 | 5 | 20 | bez limitu |
| Storage backend | FTP (współdzielony) | FTP (dedykowany) | AWS S3 / FTP | dowolny (konfigurowalny) |
| Max rozmiar bazy | 50 MB | 200 MB | 1 GB | konfigurowalny |
| Min interwał sync | 24h | 8h | 1h | 15 min |
| Fixed master | nie | nie | tak | tak |
| Kolejka sync | nie (max 2 urządzenia) | podstawowa | priorytetowa | priorytetowa + harmonogram |
| Historia sync | 7 dni | 30 dni | 90 dni | bez limitu |
| Wsparcie | community | email | priorytetowe | dedykowane |

### 14.4 Przepływ rejestracji i aktywacji

```
┌──────────┐                              ┌──────────────┐
│ Klient   │  1. POST /license/activate   │ Serwer Sync  │
│          │  { license_key, device_id,   │              │
│          │    device_name, os_info }    │              │
│          │ ─────────────────────────────►│              │
│          │                              │ Waliduje:    │
│          │                              │ - klucz OK?  │
│          │                              │ - nie wygasł?│
│          │                              │ - limit urz.?│
│          │  2. Response:                │              │
│          │  { auth_token, group_id,     │              │
│          │    plan, limits,             │              │
│          │    fixed_master: true/false,  │              │
│          │    sync_enabled: true }      │              │
│          │ ◄─────────────────────────────│              │
└──────────┘                              └──────────────┘
```

**Klient po aktywacji:**
- Zapisuje `auth_token` (Bearer token do dalszej komunikacji)
- Zapisuje `group_id`, `plan`, `limits` (wie co mu wolno)
- Wie czy jest `fixed_master` (jeśli tak — zawsze zgłasza się jako master)
- Cyklicznie odpytuje `/license/status` (co 24h) by wykryć zmiany planu/wygaśnięcie

### 14.5 Walidacja licencji przy sync

Każde wywołanie `/sync/session/create` przechodzi przez walidację:

```
1. Sprawdź auth_token → identyfikacja device + group
2. Sprawdź licenseStatus:
   - "expired" / "suspended" / "revoked" → 403 { error: "license_inactive", renewUrl: "..." }
   - "trial" → OK, ale z ograniczeniami planu free
   - "active" → OK
3. Sprawdź limity planu:
   - Liczba urządzeń w grupie <= maxDevices?
   - Ostatnia sync < minSyncFrequency temu? → 429 { error: "sync_too_frequent", retryAfter: "..." }
   - Rozmiar bazy (z table_hashes) <= maxDatabaseSize?
4. Rozstrzygnij storage backend → z konfiguracji grupy/licencji
5. Rozstrzygnij rolę MASTER/SLAVE:
   - fixedMasterDeviceId ustawiony? → ten device = master, reszta = slave
   - brak fixed master? → dynamicznie (pierwszy = master, tie-break po device_id)
6. Sprawdź kolejkę → czy jest aktywna sesja dla tej grupy?
   - tak → dodaj do kolejki pendingDevices
   - nie → utwórz sesję
```

### 14.6 Klucz licencji — format i walidacja

```
Format: TF-{PLAN}-{ROK}-{XXXX}-{XXXX}-{XXXX}
Przykład: TF-PRO-2026-A7K2-M9X4-R3J8

Walidacja offline (klient):
- Sprawdzenie formatu (regex)
- Sprawdzenie checksum (ostatni segment = CRC16 reszty)
- NIE gwarantuje aktywności — tylko poprawność formatu

Walidacja online (serwer):
- Pełna weryfikacja: istnienie, status, limity, przynależność do grupy
- Serwer jest jedynym źródłem prawdy o ważności licencji
```

### 14.7 Endpointy licencji

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/license/activate` | POST | Aktywacja licencji + rejestracja urządzenia → zwraca auth_token |
| `/license/status` | GET | Stan licencji, plan, limity, lista urządzeń w grupie |
| `/license/deactivate-device` | POST | Odrejestrowanie urządzenia (zwalnia slot) |
| `/license/refresh-token` | POST | Odświeżenie auth_token (przed wygaśnięciem tokenu) |

### 14.8 Storage backend per licencja — jak to działa

```
┌──────────┐  create session   ┌──────────────┐  lookup license   ┌─────────────────┐
│ Klient   │ ────────────────► │ Serwer Sync  │ ───────────────►  │ License Store   │
│          │                   │              │                    │                 │
│          │                   │              │ ◄───────────────── │ groupId: G1     │
│          │                   │              │  storageBackend:   │ plan: pro       │
│          │                   │              │  "aws-s3"          │ backend: aws-s3 │
│          │                   │              │                    └─────────────────┘
│          │                   │              │
│          │                   │  generuje credentiale dla backendu S3:
│          │                   │  - presigned upload URL
│          │                   │  - presigned download URL
│          │                   │  - session path: s3://bucket/G1/{session_id}/
│          │                   │              │
│          │  status response  │              │
│          │ ◄──────────────── │              │
│          │  { storage: {     │              │
│          │    type: "aws-s3",│              │
│          │    uploadUrl,     │              │
│          │    downloadUrl    │              │
│          │  }}               │              │
└──────────┘                   └──────────────┘
```

**Klient nie musi znać backendu z góry.** Serwer zwraca:
- Typ backendu → klient wie czy użyć FTP, HTTP (presigned URL), czy innego protokołu
- Credentiale/URL → specyficzne per backend, zaszyfrowane

**Abstrakcja po stronie klienta (Rust):**

```rust
trait StorageTransport {
    fn upload(&self, local_path: &Path, session_key: &[u8]) -> Result<String>;  // → remote hash
    fn download(&self, target_path: &Path, session_key: &[u8]) -> Result<()>;
}

struct FtpTransport { host: String, port: u16, user: String, pass: String, path: String }
struct S3Transport { upload_url: String, download_url: String }     // presigned URLs
struct HttpTransport { upload_url: String, download_url: String }   // generic HTTP PUT/GET
```

### 14.9 Zmiany w planie implementacji

Licencjonowanie wymaga dodania nowych zadań:

**Faza 0 (przed wszystkim): Licencje na serwerze**

| # | Zadanie | Pliki |
|---|---------|-------|
| 0.1 | Model danych: License, ClientGroup, DeviceRegistration | `src/lib/sync/license.ts` |
| 0.2 | License store (CRUD, walidacja) | `src/lib/sync/license-store.ts` |
| 0.3 | Endpointy: activate, status, deactivate-device, refresh-token | `src/app/api/license/` |
| 0.4 | Storage backend registry (mapa group → backend config) | `src/lib/sync/storage-backends.ts` |
| 0.5 | Middleware walidacji licencji na endpointach /sync/* | `src/lib/sync/license-middleware.ts` |
| 0.6 | Generowanie kluczy licencji (admin tool) | `src/lib/sync/license-keygen.ts` |

**Faza 3 (klient) — rozszerzenie:**

| # | Zadanie | Pliki |
|---|---------|-------|
| 3.0 | Aktywacja licencji przy pierwszym uruchomieniu | `src/online_sync.rs`, `src/config.rs` |
| 3.2a | Abstrakcja StorageTransport (FTP + S3 + HTTP) | `src/storage_transport.rs` |
| 3.7 | Cykliczne sprawdzanie statusu licencji (co 24h) | `src/online_sync.rs` |

**Faza 4 (dashboard) — rozszerzenie:**

| # | Zadanie | Pliki |
|---|---------|-------|
| 4.0 | Ekran aktywacji licencji (input klucza, status) | `components/settings/LicenseCard.tsx` |
| 4.6 | Wyświetlanie planu, limitów, listy urządzeń w grupie | `pages/Settings.tsx` |

### 14.10 Migracja z obecnego auth (Bearer token)

| Faza | Stan |
|------|------|
| **Teraz** | `SYNC_API_TOKENS=userId=token` w .env serwera — ręcznie zarządzane |
| **Przejściowa** | Istniejące tokeny działają równolegle z nowym systemem licencji. Klienty bez licencji → plan "free" (domyślny) |
| **Docelowa** | Tylko licencje. Token wydawany automatycznie po `/license/activate`. Stare tokeny wygasają po migracji |

Klienty zaktualizowane do nowej wersji:
1. Przy pierwszym uruchomieniu → wyświetlają ekran "Wprowadź klucz licencji"
2. Po aktywacji → otrzymują auth_token automatycznie
3. Dalej działają jak dotąd (token w nagłówku Authorization)

Klienty na starej wersji:
- Nadal mogą używać ręcznych tokenów (faza przejściowa)
- Serwer traktuje je jako plan "free"
- Po usunięciu starych tokenów → muszą zaktualizować
