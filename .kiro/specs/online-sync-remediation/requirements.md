# Requirements Document

Plan poprawek warstwy synchronizacji online (`online-sync-remediation`)

## Introduction

Dokument definiuje wymagania dla remediacji ustaleń audytu bezpieczeństwa i logiki
(`audyt_synchronizacji_online_2026-07-01.md`) warstwy synchronizacji online projektu
`__cfab_server` (Next.js App Router + Prisma/Postgres + SFTP/FTP/S3, serverless na
Vercel). Wymagania są wyprowadzone z dokumentu projektowego (`design.md`) i pogrupowane
w te same workstreamy (WS-A…WS-F). Kolejność odpowiada priorytetom audytu: najpierw
trzy ustalenia krytyczne (#1 fałszywy E2E, #2 nieskuteczny rate limiting, #3
nieuwierzytelnione `deviceId`), następnie średnie i hardening.

Odwołania do właściwości poprawności (CP-1…CP-14) wskazują testy weryfikujące dane
wymaganie; pełne definicje właściwości znajdują się w `design.md` (sekcja *Correctness
Properties*).

## Glossary

- **Demon / klient** — aplikacja `__cfab_demon` synchronizująca dane urządzenia.
- **Token urządzenia** — `LicenseDevice.apiToken`; uwierzytelnia konkretne urządzenie.
- **Env-token** — token z `SYNC_API_TOKENS`; działa w imieniu właściciela grupy, bez
  tożsamości urządzenia.
- **Passphrase grupy** — sekret znany wyłącznie klientom grupy, nigdy niewysyłany na
  serwer (podstawa E2E v2).
- **Store limitera** — współdzielony backend liczników (Vercel KV / Upstash Redis).

---

## Requirements

### Wymaganie 1 — Realny model E2E z sekretem klienta (WS-D, ustalenia #1, #9)

**User story:** Jako administrator bezpieczeństwa chcę, aby klucz szyfrujący dane i
kredencjały storage zależał od sekretu znanego wyłącznie klientom, aby serwer (ani
osoba znająca `groupId`) nie mógł odtworzyć kluczy i odszyfrować danych.

#### Kryteria akceptacji

1. WHEN klient wyprowadza klucz grupy w schemacie v2, THE SYSTEM SHALL użyć funkcji
   `deriveGroupKeyV2(passphrase, groupId)` opartej na `scrypt` (lub równoważnym KDF
   pamięciochłonnym) z `passphrase` jako materiałem sekretnym i `groupId` jako
   solą/kontekstem oraz separatorem domeny `v2`. *(CP-10, CP-11)*
2. IF żądanie nie zawiera znajomości `passphrase`, THEN THE SYSTEM SHALL NOT posiadać
   żadnej czysto-serwerowej funkcji odtwarzającej klucz v2 (w przeciwieństwie do v1,
   gdzie sam `groupId` wystarczał). *(CP-10)*
3. WHEN dwa urządzenia znają tę samą parę `(passphrase, groupId)`, THE SYSTEM SHALL
   wyprowadzić identyczny klucz, umożliwiając krzyżową deszyfrację danych grupy. *(CP-11)*
4. WHERE paczka async lub sesja jest tworzona, THE SYSTEM SHALL zapisać `keyScheme`
   (`v1-groupid` | `v2-passphrase`) oraz `keySalt` (base64; wymagane dla v2, null dla
   v1) w metadanych, aby v1 i v2 mogły współistnieć w okresie migracji.
5. IF żądanie deklaruje `keyScheme` spoza zbioru {`v1-groupid`, `v2-passphrase`}, THEN
   THE SYSTEM SHALL odrzucić je z kodem `unsupported_key_scheme` (400).
6. IF żądanie nie deklaruje `keyScheme`, THEN THE SYSTEM SHALL przyjąć domyślnie
   `v1-groupid` (kompatybilność wsteczna, brak błędu).
7. WHILE flota nie została w pełni zmigrowana, THE SYSTEM SHALL obsługiwać deszyfrację
   i tworzenie paczek zarówno v1, jak i v2, umożliwiając bezpieczny rollback demona lub
   serwera bez uszkodzenia istniejących paczek.
8. WHERE wybrano docelową Opcję C (bring-your-own-storage), THE SYSTEM SHALL
   przechowywać wyłącznie zaszyfrowane po stronie klienta kredencjały storage
   (`Group.clientEncryptedStorageConfig`) i nie znać hasła storage w plaintext.

### Wymaganie 2 — Współdzielony rate limiter na serverless (WS-C, ustalenie #2)

**User story:** Jako operator platformy chcę, aby limity żądań były egzekwowane
globalnie na wszystkich instancjach lambda, aby ochrona przed brute-force i nadużyciami
działała na Vercelu.

#### Kryteria akceptacji

1. WHEN wiele instancji lambda obsługuje żądania o tym samym kluczu limitu w tym samym
   oknie, THE SYSTEM SHALL utrzymywać jeden współdzielony licznik w store (Vercel KV /
   Upstash Redis) inkrementowany atomowo (`INCR` + `PEXPIRE NX`). *(CP-6)*
2. WHEN sekwencja `n` żądań o tym samym kluczu trafia w oknie `windowMs` (rozproszona na
   dowolną liczbę instancji), THE SYSTEM SHALL zezwolić na co najwyżej `limit` żądań z
   `allowed=true`. *(CP-6)*
3. WHEN upłynie `windowMs` od pierwszego żądania okna, THE SYSTEM SHALL rozpocząć nowe
   okno (reset licznika do 1). *(CP-7)*
4. IF store limitera jest niedostępny na trasie skonfigurowanej jako `fail-closed`
   (np. `license/activate`), THEN THE SYSTEM SHALL odrzucić żądanie z kodem
   `rate_limited` (429).
5. IF store limitera jest niedostępny na trasie skonfigurowanej jako `fail-open`
   (trasy sync), THEN THE SYSTEM SHALL przepuścić żądanie i zapisać ostrzeżenie w logu.
6. THE SYSTEM SHALL czytać tryb awaryjny z `RATE_LIMIT_FAILURE_MODE` (domyślnie
   `fail-open`) oraz override `LICENSE_ACTIVATE_RATE_LIMIT_MODE` (domyślnie
   `fail-closed`).
7. THE SYSTEM SHALL zachować kontrakt wyniku `RateLimitResult`
   (`allowed`, `limit`, `remaining`, `resetAt`, `retryAfterMs`) mimo zmiany na backend
   współdzielony.

### Wymaganie 3 — Związanie `deviceId` z tokenem urządzenia (WS-B, ustalenie #3)

**User story:** Jako właściciel danych chcę, aby urządzenie nie mogło podszyć się pod
inne urządzenie w mojej grupie, aby nie dało się sfałszować zakończenia sesji ani
wyłudzić kredencjałów cudzej paczki.

#### Kryteria akceptacji

1. WHEN żądanie jest uwierzytelnione tokenem urządzenia, THE SYSTEM SHALL dołączyć do
   kontekstu auth `tokenDeviceId` odczytany z rekordu urządzenia (`findDeviceByToken`).
2. IF `method="device-token"` ORAZ `body.deviceId ≠ tokenDeviceId` (lub `body.deviceId`
   jest puste), THEN THE SYSTEM SHALL odrzucić żądanie z kodem `device_id_mismatch`
   (403). *(CP-3)*
3. WHEN `method="token"` (env-token) lub `method="dev-body-userid"` (`tokenDeviceId`
   jest null), THE SYSTEM SHALL NOT egzekwować zgodności `deviceId` (zachowanie bez
   zmian). *(CP-4)*
4. THE SYSTEM SHALL egzekwować związanie `deviceId` w `handleSyncPost` oraz
   `handleSyncGet` bezpośrednio po uwierzytelnieniu, przed rate-limitem i wykonaniem
   handlera.
5. WHEN pojedyncze urządzenie próbuje zaraportować krok 13 zarówno jako `masterDeviceId`,
   jak i `slaveDeviceId`, THE SYSTEM SHALL uniemożliwić przejście sesji w `completed`,
   ponieważ każdy raport jest przypięty do przypiętego `deviceId`. *(CP-5)*
6. WHEN urządzenie wywołuje `async/ack`, `async/reject` lub `async/credentials` z
   `deviceId` innego urządzenia, THE SYSTEM SHALL odrzucić żądanie (`device_id_mismatch`),
   uniemożliwiając nadużycie ścieżki `isOwnerCleanup`.

### Wymaganie 4 — Walidacja strukturalna JSON (WS-A, ustalenie #5)

**User story:** Jako operator chcę, aby ładunki JSON były ograniczone strukturalnie
(nie tylko rozmiarem w bajtach), aby zapobiec DoS przez ogromne tablice/głębokie
zagnieżdżenia mieszczące się w limicie 20 MB.

#### Kryteria akceptacji

1. WHEN `parseJsonBody` sparsuje ładunek (ścieżka gzip i nieskompresowana), THE SYSTEM
   SHALL wywołać `assertJsonStructure` z limitami `syncMaxArrayItems`,
   `syncMaxObjectKeys`, `syncMaxJsonDepth` przed zwróceniem ciała.
2. IF jakakolwiek tablica przekracza `maxArrayItems`, obiekt przekracza `maxObjectKeys`,
   lub głębokość przekracza `maxDepth`, THEN THE SYSTEM SHALL odrzucić żądanie z kodem
   `payload_structure_exceeded` (400). *(CP-1)*
3. WHEN ładunek mieści się we wszystkich limitach, THE SYSTEM SHALL zwrócić go bez
   modyfikacji i bez rzucania błędu. *(CP-2)*
4. THE SYSTEM SHALL wykonywać obchód struktury iteracyjnie (jawny stos), aby wrogie
   głębokie wejście nie przepełniło stosu wywołań.

### Wymaganie 5 — Aktywny throttling częstotliwości sync (WS-A, ustalenie #6)

**User story:** Jako operator chcę, aby limit `maxSyncFrequencyHours` był realnie
egzekwowany dla sesji, aby plany licencyjne z ograniczeniem częstotliwości działały.

#### Kryteria akceptacji

1. WHEN `handleSessionCreate` rozwiązuje kontekst licencji, THE SYSTEM SHALL odczytać
   realny `DeviceRegistration` po `deviceId` (z prawdziwym `lastSyncAt`), zamiast
   przekazywać `device=null`.
2. IF urządzenie ma `lastSyncAt = t`, grupa ma `maxSyncFrequencyHours = h > 0`, a
   żądanie sync następuje w chwili `now < t + h·3600s`, THEN THE SYSTEM SHALL odrzucić
   je z kodem `sync_too_frequent` (429) wraz z `retryAfterMs`. *(CP-9)*
3. WHEN `now ≥ t + h·3600s`, THE SYSTEM SHALL przepuścić żądanie sync. *(CP-9)*
4. WHEN sync zakończy się sukcesem, THE SYSTEM SHALL zaktualizować `lastSyncAt`
   urządzenia, aby kolejne wywołania widziały świeży znacznik.

### Wymaganie 6 — Zaufany parsing IP klienta (WS-C, ustalenie #4)

**User story:** Jako operator chcę, aby identyfikacja IP klienta pochodziła z zaufanego
proxy platformy, aby nie dało się obejść limitów per-IP przez fałszowanie nagłówka
`X-Forwarded-For`.

#### Kryteria akceptacji

1. WHEN dostępny jest nagłówek platformy (`x-real-ip` / `x-vercel-forwarded-for`), THE
   SYSTEM SHALL użyć go jako źródła IP klienta.
2. IF nagłówek platformy jest niedostępny, THEN THE SYSTEM SHALL użyć ostatniego
   (najbardziej prawego) wpisu `X-Forwarded-For` dodanego przez zaufane proxy.
3. THE SYSTEM SHALL NOT nigdy zwracać lewego (sterowanego przez klienta) wpisu
   `X-Forwarded-For`. *(CP-8)*
4. IF żadne zaufane źródło nie dostarcza poprawnego IP, THEN THE SYSTEM SHALL zwrócić
   `null`.

### Wymaganie 7 — Hardening (WS-E, ustalenia #7, #8, #10, #11, #12)

**User story:** Jako administrator chcę domknięcia mniejszych podatności, aby
zredukować powierzchnię ataku i wycieki informacji.

#### Kryteria akceptacji

1. WHEN użytkownik loguje się do panelu, THE SYSTEM SHALL wystawić krótkotrwały,
   podpisany sekret sesji (`httpOnly`, `secure` w prod, `sameSite=lax`) zamiast
   przechowywać surowy token API w cookie; kradzież cookie SHALL NOT ujawniać
   długożyjącego tokenu API. *(#7)*
2. THE SYSTEM SHALL respektować `syncAllowedOrigins` przy ustalaniu nagłówków CORS i
   SHALL NOT zwracać `*` na sztywno na trasach licencji; `*` tylko przy jawnej
   konfiguracji (z ostrzeżeniem w prod). *(#8)*
3. WHEN błąd infrastruktury jest mapowany przez `mapInfraError`, THE SYSTEM SHALL NOT
   dołączać `prismaCode` do odpowiedzi klienta; kod SHALL być tylko w logach serwera. *(CP-14, #10)*
4. IF w kroku 12 marker slave'a różni się od markera mastera, THEN THE SYSTEM SHALL
   ustawić sesję na `failed` z `errorMessage="marker_mismatch"` zamiast miękkiego
   ostrzeżenia, uniemożliwiając `completed` na rozbieżnych danych. *(#11)*
5. WHEN weryfikowany jest token administratora, THE SYSTEM SHALL użyć porównania
   stałoczasowego bez wczesnej gałęzi porównującej długość (porównanie na buforze
   paddowanym do stałej długości). *(#12)*

### Wymaganie 8 — Poprawność deduplikacji delta (WS-F)

**User story:** Jako użytkownik chcę, aby scalanie delty nie gubiło różnych, ale
równoczasowych rekordów, aby dane feedbacku i auto-runów były kompletne.

#### Kryteria akceptacji

1. WHEN scalane są `assignment_feedback` / `assignment_auto_runs`, THE SYSTEM SHALL
   ustalać tożsamość rekordu na podstawie pełnego naturalnego klucza (preferencyjnie
   `uuid`/`id`, w innym wypadku znacznik czasu + pola tożsamości + skrót treści), a nie
   samego znacznika czasu.
2. WHEN dwa rekordy `r1 ≠ r2` mają ten sam znacznik czasu, ale różnią się na polach
   tożsamości, THE SYSTEM SHALL zachować oba w wyniku scalania (żaden nie zostaje
   zgubiony ani scalony). *(CP-12)*
3. WHEN rekord `r` jest już obecny w kolekcji docelowej, THE SYSTEM SHALL NOT utworzyć
   duplikatu przy ponownym scaleniu (idempotencja). *(CP-13)*

---

## Zależności i ograniczenia

- **Współdzielony store limitera:** wymaga provisioning Vercel KV / Upstash Redis i
  zmiennych `KV_REST_API_URL` / `KV_REST_API_TOKEN` (lub odpowiedników Upstash).
- **Kompatybilność z `__cfab_demon`:** WS-D wymaga koordynacji wersji (KDF v2, odczyt
  `keyScheme`, UI passphrase). Env-tokeny i demony v1 SHALL działać bez zmian do fazy
  deprecjacji v1.
- **Migracje Prisma:** wyłącznie addytywne (nullowalne kolumny `keyScheme`/`keySalt`,
  opcjonalnie `DashboardSession`, `Group.clientEncryptedStorageConfig`).
- **Nowe zmienne środowiskowe:** `KV_REST_API_URL`, `KV_REST_API_TOKEN`,
  `RATE_LIMIT_FAILURE_MODE`, `LICENSE_ACTIVATE_RATE_LIMIT_MODE`, `E2E_KEY_SCHEME`,
  `DASHBOARD_SESSION_SECRET`.
