# TimeFlow Sync Server UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Przebudować istniejący panel w techniczną konsolę synchronizacji z operacyjnym Overview, stałą nawigacją i osobnymi widokami zasobów.

**Architecture:** Zachować chroniony route `/` oraz pobieranie danych po stronie serwera. Parametr `view` wybiera renderowany ekran, a nowy shell i małe komponenty prezentacyjne rozbijają obecny `src/app/page.tsx` bez zmiany API i logiki domenowej. Wspólny plik CSS dostarcza tokeny oraz klasy interfejsu, a Vitest testuje parser nawigacji, model Overview i najważniejsze stany renderowania.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, CSS custom properties, Vitest, Testing Library, jsdom.

---

## Mapa plików

**Nowe pliki:**

- `src/lib/dashboard/navigation.ts` — typy widoków i bezpieczny parser parametru `view`.
- `src/lib/dashboard/overview.ts` — czysty model stanu Overview.
- `src/lib/dashboard/navigation.test.ts` — testy routingu widoków.
- `src/lib/dashboard/overview.test.ts` — testy stanu systemu i checklisty.
- `src/components/dashboard/dashboard-shell.tsx` — rail, topbar i kontener treści.
- `src/components/dashboard/dashboard-overview.tsx` — zatwierdzony ekran Overview.
- `src/components/dashboard/dashboard-ui.tsx` — status dot, empty state, panel i nagłówki sekcji.
- `src/components/dashboard/dashboard-command-menu.tsx` — dostępna paleta `⌘K`/`Ctrl+K`.
- `src/components/dashboard/dashboard-drawer.tsx` — wspólny drawer formularzy.
- `src/components/dashboard/dashboard-drawer.test.tsx` — fokus, Escape i semantyka drawera.
- `src/components/dashboard/devices-view.tsx` — tabela/lista urządzeń.
- `src/components/dashboard/activity-view.tsx` — historia Direct Sync.
- `src/components/dashboard/licenses-view.tsx` — licencje.
- `src/components/dashboard/groups-view.tsx` — grupy klientów.
- `src/components/dashboard/storage-view.tsx` — backendy storage.
- `src/components/dashboard/dashboard-shell.test.tsx` — test nawigacji i semantyki shell.
- `src/components/dashboard/dashboard-overview.test.tsx` — test stanów Overview.
- `src/test/setup.ts` — matchery DOM.
- `src/app/dashboard.css` — tokeny, shell, tabele, formularze, responsywność i reduced motion.

**Modyfikowane pliki:**

- `package.json` — skrypt `test` i zależności testowe.
- `src/app/layout.tsx` — import `dashboard.css`, font i metadane.
- `src/app/globals.css` — pozostawić import Tailwind; usunąć konflikt Arial/system-ui.
- `src/app/page.tsx` — ograniczyć do auth, pobrania danych, wyboru widoku i kompozycji.
- `src/components/create-license-form.tsx` — formularz jako zawartość drawera, pełne stany.
- `src/components/group-form.tsx` — formularz jako zawartość drawera.
- `src/components/storage-backend-form.tsx` — formularze tworzenia/edycji i testu w nowym systemie klas.
- `src/components/sync-status-login-form.tsx` — spójny ekran logowania i fokus.
- `src/components/copy-token-button.tsx` — spójne stany kopiowania.
- `src/components/clear-sync-history-button.tsx` — spójny stan destrukcyjny.

## Task 1: Dodać test harness

**Files:**
- Modify: `package.json`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Zainstalować zależności testowe**

Run:

```bash
npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom
```

Expected: `package.json` i `package-lock.json` zawierają cztery zależności deweloperskie.

- [ ] **Step 2: Dodać skrypt i konfigurację Vitest do `package.json`**

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run"
  },
  "vitest": {
    "environment": "jsdom",
    "setupFiles": ["./src/test/setup.ts"]
  }
}
```

- [ ] **Step 3: Dodać matchery DOM**

```ts
// src/test/setup.ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Uruchomić pusty zestaw testów**

Run: `npm test -- --passWithNoTests`

Expected: PASS bez znalezionych testów.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/test/setup.ts
git commit -m "test: add dashboard UI test harness"
```

## Task 2: Zdefiniować nawigację widoków

**Files:**
- Create: `src/lib/dashboard/navigation.test.ts`
- Create: `src/lib/dashboard/navigation.ts`

- [ ] **Step 1: Napisać test parsera**

```ts
// src/lib/dashboard/navigation.test.ts
import { describe, expect, it } from "vitest";
import { parseDashboardView } from "./navigation";

describe("parseDashboardView", () => {
  it.each(["overview", "activity", "devices", "licenses", "groups", "storage"])(
    "accepts %s",
    (view) => expect(parseDashboardView(view)).toBe(view),
  );

  it.each([undefined, null, "", "unknown", ["devices"]])(
    "falls back to overview for %j",
    (view) => expect(parseDashboardView(view)).toBe("overview"),
  );
});
```

- [ ] **Step 2: Potwierdzić czerwony test**

Run: `npm test -- src/lib/dashboard/navigation.test.ts`

Expected: FAIL — moduł `./navigation` nie istnieje.

- [ ] **Step 3: Zaimplementować typ i parser**

```ts
// src/lib/dashboard/navigation.ts
export const DASHBOARD_VIEWS = [
  "overview",
  "activity",
  "devices",
  "licenses",
  "groups",
  "storage",
] as const;

export type DashboardView = (typeof DASHBOARD_VIEWS)[number];

export function parseDashboardView(value: unknown): DashboardView {
  return typeof value === "string" &&
    DASHBOARD_VIEWS.includes(value as DashboardView)
    ? (value as DashboardView)
    : "overview";
}
```

- [ ] **Step 4: Potwierdzić zielony test**

Run: `npm test -- src/lib/dashboard/navigation.test.ts`

Expected: PASS — 11 przypadków.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/navigation.ts src/lib/dashboard/navigation.test.ts
git commit -m "feat: define dashboard view navigation"
```

## Task 3: Zbudować testowalny model Overview

**Files:**
- Create: `src/lib/dashboard/overview.test.ts`
- Create: `src/lib/dashboard/overview.ts`

- [ ] **Step 1: Napisać test statusu degraded i checklisty**

```ts
// src/lib/dashboard/overview.test.ts
import { describe, expect, it } from "vitest";
import { buildDashboardOverview } from "./overview";

const emptyData = {
  licenses: [],
  groups: [],
  devices: [],
  storageBackends: [],
  directSyncHistory: [],
};

describe("buildDashboardOverview", () => {
  it("marks the system degraded when storage is offline", () => {
    const result = buildDashboardOverview(
      emptyData,
      { available: false, lastCheckAt: "2026-06-23T12:00:00.000Z", activeSessions: 0, orphanedDirs: 0, error: "ECONNREFUSED" },
      192,
    );

    expect(result.systemStatus).toBe("degraded");
    expect(result.alert?.targetView).toBe("storage");
    expect(result.setup.completed).toBe(1);
    expect(result.counts).toEqual({ devices: 0, licenses: 0, groups: 0, storageBackends: 0 });
  });

  it("marks setup complete when storage, a license and a device exist", () => {
    const result = buildDashboardOverview(
      { ...emptyData, licenses: [{}], groups: [{}], devices: [{}], storageBackends: [{}] } as never,
      { available: true, lastCheckAt: "2026-06-23T12:00:00.000Z", activeSessions: 0, orphanedDirs: 0, error: null },
      3600,
    );

    expect(result.systemStatus).toBe("operational");
    expect(result.setup.completed).toBe(4);
    expect(result.alert).toBeNull();
  });
});
```

- [ ] **Step 2: Potwierdzić czerwony test**

Run: `npm test -- src/lib/dashboard/overview.test.ts`

Expected: FAIL — `buildDashboardOverview` nie istnieje.

- [ ] **Step 3: Zaimplementować model bez zależności od Reacta**

```ts
// src/lib/dashboard/overview.ts
import type { DashboardData } from "@/lib/sync/dashboard";
import type { SftpHealthStatus } from "@/lib/sync/sftp-manager";

export function buildDashboardOverview(
  data: DashboardData,
  storage: SftpHealthStatus,
  uptimeSeconds: number,
) {
  const counts = {
    devices: data.devices.length,
    licenses: data.licenses.length,
    groups: data.groups.length,
    storageBackends: data.storageBackends.length,
  };
  const completed = 1 + Number(storage.available) + Number(counts.licenses > 0) + Number(counts.devices > 0);

  return {
    systemStatus: storage.available ? "operational" as const : "degraded" as const,
    uptimeSeconds,
    counts,
    recentActivity: data.directSyncHistory.slice(0, 8),
    setup: { completed, total: 4 },
    alert: storage.available ? null : {
      title: "Storage jest niedostępny",
      description: storage.error ?? "Sprawdź konfigurację i połączenie backendu.",
      targetView: "storage" as const,
    },
  };
}

export type OverviewModel = ReturnType<typeof buildDashboardOverview>;
```

- [ ] **Step 4: Uruchomić test**

Run: `npm test -- src/lib/dashboard/overview.test.ts`

Expected: PASS — 2 testy.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/overview.ts src/lib/dashboard/overview.test.ts
git commit -m "feat: add sync dashboard overview model"
```

## Task 4: Wprowadzić tokeny i shell konsoli

**Files:**
- Create: `src/app/dashboard.css`
- Create: `src/components/dashboard/dashboard-ui.tsx`
- Create: `src/components/dashboard/dashboard-shell.tsx`
- Create: `src/components/dashboard/dashboard-shell.test.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Napisać test semantyki i aktywnej nawigacji**

```tsx
// src/components/dashboard/dashboard-shell.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardShell } from "./dashboard-shell";

describe("DashboardShell", () => {
  it("exposes navigation and marks the current view", () => {
    render(<DashboardShell currentView="devices" userId="admin@example.com"><p>Treść</p></DashboardShell>);
    expect(screen.getByRole("navigation", { name: "Panel synchronizacji" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Urządzenia" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Treść")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Potwierdzić czerwony test**

Run: `npm test -- src/components/dashboard/dashboard-shell.test.tsx`

Expected: FAIL — `DashboardShell` nie istnieje.

- [ ] **Step 3: Zaimplementować shell jako komponent serwerowy**

`DashboardShell` przyjmuje tylko `currentView`, `userId` i `children`. Linki prowadzą do `/?view=<name>`, aktywny link ma `aria-current="page"`, a wylogowanie pozostaje formularzem POST do `/auth/logout`. Nie przenosić do niego pobierania danych.

```tsx
const NAV_ITEMS = [
  ["overview", "Przegląd"],
  ["activity", "Aktywność synchronizacji"],
  ["devices", "Urządzenia"],
  ["licenses", "Licencje"],
  ["groups", "Grupy"],
  ["storage", "Storage"],
] as const;

export function DashboardShell({ currentView, userId, children }: Props) {
  return (
    <div className="dashboard-shell">
      <aside className="dashboard-rail">
        <a className="dashboard-brand" href="/?view=overview">TimeFlow Sync</a>
        <nav aria-label="Panel synchronizacji">
          {NAV_ITEMS.map(([view, label]) => (
            <a key={view} href={`/?view=${view}`} aria-current={currentView === view ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <div className="dashboard-account"><strong>{userId}</strong><span>Administrator</span></div>
      </aside>
      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <span>TimeFlow Sync / {NAV_ITEMS.find(([view]) => view === currentView)?.[1]}</span>
          <DashboardCommandMenu />
        </header>
        <div className="dashboard-content">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Dodać tokeny i klasy**

Pierwsza linia `dashboard.css`:

```css
/* Hallmark · macrostructure: Workbench · tone: technical-austere · anchor hue: status-only */
:root {
  --dashboard-bg: oklch(14% 0 0);
  --dashboard-surface: oklch(17% 0 0);
  --dashboard-line: oklch(26% 0 0);
  --dashboard-text: oklch(94% 0 0);
  --dashboard-muted: oklch(62% 0 0);
  --dashboard-danger: oklch(68% 0.19 24);
  --dashboard-success: oklch(76% 0.16 152);
  --dashboard-warning: oklch(80% 0.13 82);
  --dashboard-focus: oklch(94% 0 0);
  --dashboard-radius-control: 6px;
  --dashboard-radius-surface: 8px;
  --dashboard-ease-out: cubic-bezier(.16, 1, .3, 1);
}
```

Zdefiniować grid 228 px + `minmax(0, 1fr)`, sticky rail/topbar, powierzchnie 1 px, `:focus-visible`, breakpointy 900/640 px i `prefers-reduced-motion`.

- [ ] **Step 5: Usunąć konflikt fontów**

W `globals.css` pozostawić `@import "tailwindcss"`; w `body` użyć `font-family: var(--font-sans)`. W `layout.tsx` dodać `import "./dashboard.css"` i zmienić metadata na `TimeFlow Sync Server`.

- [ ] **Step 6: Uruchomić testy i lint**

Run: `npm test -- src/components/dashboard/dashboard-shell.test.tsx && npm run lint`

Expected: PASS i brak błędów ESLint.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard.css src/app/globals.css src/app/layout.tsx src/components/dashboard/dashboard-ui.tsx src/components/dashboard/dashboard-shell.tsx src/components/dashboard/dashboard-shell.test.tsx
git commit -m "feat: add sync operations dashboard shell"
```

## Task 5: Zaimplementować zatwierdzony Overview

**Files:**
- Create: `src/components/dashboard/dashboard-overview.test.tsx`
- Create: `src/components/dashboard/dashboard-overview.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Napisać test alertu i pustej aktywności**

```tsx
// src/components/dashboard/dashboard-overview.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardOverview } from "./dashboard-overview";

it("prioritizes an offline storage alert", () => {
  render(<DashboardOverview model={{
    systemStatus: "degraded", uptimeSeconds: 192,
    counts: { devices: 0, licenses: 0, groups: 0, storageBackends: 0 },
    recentActivity: [], setup: { completed: 1, total: 4 },
    alert: { title: "Storage jest niedostępny", description: "ECONNREFUSED", targetView: "storage" },
  }} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Storage jest niedostępny");
  expect(screen.getByRole("link", { name: "Otwórz ustawienia storage" })).toHaveAttribute("href", "/?view=storage");
  expect(screen.getByText("Brak aktywności synchronizacji")).toBeInTheDocument();
});
```

- [ ] **Step 2: Potwierdzić czerwony test**

Run: `npm test -- src/components/dashboard/dashboard-overview.test.tsx`

Expected: FAIL — komponent nie istnieje.

- [ ] **Step 3: Zbudować Overview w kolejności zatwierdzonej w specyfikacji**

Komponent renderuje: nagłówek, czterokomórkowy pas statusów, alert `role="alert"`, ostatnie 8 operacji, checklistę 4 kroków i cztery liczniki zasobów. Nie wymyśla metryk i używa wyłącznie danych modelu.

- [ ] **Step 4: Podłączyć widok w `page.tsx`**

W `Home` odczytać `view` z istniejącego `searchParams`, zbudować model z `buildDashboardOverview(data, sftpHealth, process.uptime())`, a następnie renderować:

```tsx
<DashboardShell currentView={view} userId={loggedUserId}>
  {view === "overview" && <DashboardOverview model={overview} />}
</DashboardShell>
```

- [ ] **Step 5: Uruchomić test i build**

Run: `npm test -- src/components/dashboard/dashboard-overview.test.tsx && npm run build`

Expected: PASS; Next.js kończy build bez błędów typów.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/components/dashboard/dashboard-overview.tsx src/components/dashboard/dashboard-overview.test.tsx
git commit -m "feat: add operational sync overview"
```

## Task 6: Rozdzielić pięć widoków zasobów

**Files:**
- Create: `src/components/dashboard/devices-view.tsx`
- Create: `src/components/dashboard/activity-view.tsx`
- Create: `src/components/dashboard/licenses-view.tsx`
- Create: `src/components/dashboard/groups-view.tsx`
- Create: `src/components/dashboard/storage-view.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Przenieść istniejące sekcje bez zmiany logiki**

Przenieść kolejno `DevicesSection`, `DirectSyncHistorySection`, `LicensesSection`, `GroupsSection` i `StorageBackendsSection`. Zachować helpery `formatDate`, `deviceStatus`, `licenseStatusBadge` i `actionBadge` przy komponencie, który jako jedyny ich używa.

- [ ] **Step 2: Nadać każdemu widokowi wspólny kontrakt nagłówka**

```tsx
<DashboardPageHeader
  title="Urządzenia"
  description="Zarejestrowane klienty i ostatni stan połączenia."
  count={devices.length}
/>
```

Każdy widok ma jedno `h1`, jedną główną tabelę/listę oraz jeden przycisk tworzenia, jeśli zasób można tworzyć.

- [ ] **Step 3: Dodać responsywną reprezentację rekordów**

Desktop używa tabeli z `scope="col"`; poniżej 640 px każda komórka dostaje `data-label`, a CSS układa rekord jako dwukolumnową listę. Wrapper tabeli może przewijać się lokalnie między 640–900 px, ale `body` nie może mieć poziomego scrolla.

- [ ] **Step 4: Podłączyć switch widoków**

```tsx
function renderDashboardView(view: DashboardView, data: DashboardData, overview: OverviewModel) {
  switch (view) {
    case "activity": return <ActivityView entries={data.directSyncHistory} />;
    case "devices": return <DevicesView devices={data.devices} />;
    case "licenses": return <LicensesView licenses={data.licenses} groups={data.groups} />;
    case "groups": return <GroupsView groups={data.groups} storageBackends={data.storageBackends} licenses={data.licenses} />;
    case "storage": return <StorageView storageBackends={data.storageBackends} />;
    default: return <DashboardOverview model={overview} />;
  }
}
```

- [ ] **Step 5: Uruchomić pełne testy, lint i build**

Run: `npm test && npm run lint && npm run build`

Expected: wszystkie komendy kończą się kodem 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/components/dashboard/*-view.tsx
git commit -m "refactor: split dashboard resource views"
```

## Task 7: Przenieść formularze do dostępnych drawerów

**Files:**
- Create: `src/components/dashboard/dashboard-drawer.tsx`
- Modify: `src/components/create-license-form.tsx`
- Modify: `src/components/group-form.tsx`
- Modify: `src/components/storage-backend-form.tsx`

- [ ] **Step 1: Napisać test kontraktu drawera**

Test Testing Library ma sprawdzić: trigger otwiera `role="dialog"`, `aria-modal="true"`, Escape zamyka, a fokus wraca do triggera.

- [ ] **Step 2: Potwierdzić czerwony test**

Run: `npm test -- src/components/dashboard/dashboard-drawer.test.tsx`

Expected: FAIL — drawer nie istnieje.

- [ ] **Step 3: Zaimplementować `DashboardDrawer`**

Użyć natywnego `<dialog>` sterowanego przez `showModal()`/`close()`. Komponent przyjmuje `title`, `triggerLabel` i `children`, blokuje przypadkowe zamknięcie podczas `data-loading="true"`, zamyka po Escape i ma jawny przycisk „Zamknij”.

- [ ] **Step 4: Owinąć formularze bez zmiany requestów**

- `CreateLicenseForm`: trigger „Nowa licencja”, istniejący POST `/api/admin/license`.
- `CreateGroupForm`: trigger „Nowa grupa”, istniejący POST `/api/admin/group`.
- `CreateStorageBackendForm`: trigger „Nowy backend”, istniejący POST `/api/admin/storage-backend`.
- `EditStorageBackendButton`: osobny drawer „Edytuj backend”.

Zachować aktualne payloady, loading guardy, komunikaty błędów i wyniki kopiowania klucza.

- [ ] **Step 5: Uzupełnić osiem stanów kontrolek**

Każdy trigger, submit, input i select ma klasy dla default, hover, `:focus-visible`, active, disabled, loading, error i success. Błąd formularza ma `role="alert"`; sukces ma `role="status"`.

- [ ] **Step 6: Uruchomić testy i build**

Run: `npm test && npm run build`

Expected: PASS; endpointy i payloady pozostają niezmienione.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/dashboard-drawer.tsx src/components/dashboard/dashboard-drawer.test.tsx src/components/create-license-form.tsx src/components/group-form.tsx src/components/storage-backend-form.tsx
git commit -m "feat: move resource forms into dashboard drawers"
```

## Task 8: Dodać paletę poleceń i dopracować mikrointerakcje

**Files:**
- Create: `src/components/dashboard/dashboard-command-menu.tsx`
- Modify: `src/components/dashboard/dashboard-shell.tsx`
- Modify: `src/components/copy-token-button.tsx`
- Modify: `src/components/clear-sync-history-button.tsx`
- Modify: `src/app/dashboard.css`

- [ ] **Step 1: Napisać test klawiatury palety**

Test ma wysłać `Ctrl+K`, sprawdzić widoczny dialog „Przejdź do widoku”, wpisać `stor`, znaleźć „Storage”, wysłać Escape i potwierdzić zamknięcie.

- [ ] **Step 2: Zaimplementować paletę**

Paleta zawiera wyłącznie sześć pozycji nawigacji. Nie dodawać wyszukiwania danych ani zdalnego endpointu. Strzałki zmieniają aktywną pozycję, Enter ustawia `window.location.href`, Escape zamyka.

- [ ] **Step 3: Ujednolicić stany małych akcji**

`CopyTokenButton` pokazuje „Skopiowano” przez istniejące 2 sekundy jako `role="status"`. Czyszczenie historii ma wariant danger, loading i widoczny fokus; bez zmiany endpointu.

- [ ] **Step 4: Uruchomić testy**

Run: `npm test && npm run lint`

Expected: PASS i brak ostrzeżeń o hookach/a11y.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/dashboard-command-menu.tsx src/components/dashboard/dashboard-shell.tsx src/components/copy-token-button.tsx src/components/clear-sync-history-button.tsx src/app/dashboard.css
git commit -m "feat: add dashboard command navigation"
```

## Task 9: Ujednolicić login, błędy i finalnie zweryfikować UI

**Files:**
- Modify: `src/components/sync-status-login-form.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/dashboard.css`

- [ ] **Step 1: Zastosować wspólne tokeny na loginie**

Zachować pola `i` i `k`, POST `/auth/login`, obsługę `auth=invalid` oraz przycisk pokazania hasła. Zmienić tylko strukturę wizualną, polskie diakrytyki, fokus i komunikaty `role="alert"`/`role="status"`.

- [ ] **Step 2: Zastosować wspólny panel błędu odczytu**

Catch w `Home` nadal pokazuje bezpieczny `message`, ale używa tokenów dashboardu i oferuje link „Spróbuj ponownie” do `/`.

- [ ] **Step 3: Uruchomić automatyczną weryfikację**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: trzy komendy kończą się kodem 0.

- [ ] **Step 4: Uruchomić lokalnie i zweryfikować przeglądarką**

Run: `npm run dev`

Sprawdzić po zalogowaniu:

- 1280 px: pełny rail, alert storage nad foldem, wszystkie widoki działają;
- 768 px: zwężony rail, brak poziomego scrolla strony;
- 414, 375 i 320 px: mobilne menu, rekordy jako listy, kontrolki minimum 44 px;
- klawiatura: Tab, Shift+Tab, Ctrl/⌘K, strzałki, Enter, Escape;
- reduced motion: brak przesunięć, wszystkie treści od razu widoczne;
- drawer: fokus wraca do triggera po zamknięciu;
- istniejące operacje tworzenia, edycji, testowania, kopiowania i usuwania nadal wywołują te same endpointy.

- [ ] **Step 5: Sprawdzić brak regresji wizualnej**

Porównać implementację z zatwierdzoną makietą `overview-console-v1`: rail, pas statusów, alert, aktywność, checklista i pasek liczników muszą zachować tę samą hierarchię.

- [ ] **Step 6: Commit**

```bash
git add src/components/sync-status-login-form.tsx src/app/page.tsx src/app/dashboard.css
git commit -m "feat: finish sync dashboard redesign"
```

## Końcowa definicja ukończenia

- Wszystkie kryteria z `docs/superpowers/specs/2026-06-23-sync-server-ui-redesign-design.md` są pokryte przez Task 1–9.
- Nie zmieniono route'ów API, kontraktów payloadów ani logiki synchronizacji.
- Brak znaczników niedokończonej pracy i tymczasowego copy w kodzie produkcyjnym.
- Panel działa dla pustego środowiska oraz dla tabel z danymi.
- Testy, lint i build przechodzą przed ostatnim commitem.
