import { CreateLicenseForm, DeleteLicenseButton } from "@/components/create-license-form";
import type { ClientGroup, License, LicenseStatus } from "@/lib/sync/license-contracts";

import { DashboardEmptyState, DashboardPageHeader, formatDashboardDate } from "./dashboard-ui";

function licenseTone(status: LicenseStatus) {
  if (status === "active") return "success";
  if (status === "trial") return "info";
  if (status === "suspended") return "warning";
  if (status === "revoked") return "danger";
  return "neutral";
}

export function LicensesView({ licenses, groups }: { licenses: License[]; groups: ClientGroup[] }) {
  return (
    <>
      <DashboardPageHeader
        title="Licencje"
        description="Klucze dostępu, plany i limity urządzeń."
        action={<CreateLicenseForm groups={groups.map(({ id, name }) => ({ id, name }))} />}
      />
      <section className="dashboard-resource-panel">
        {licenses.length === 0 ? (
          <DashboardEmptyState symbol="◇" title="Brak licencji" description="Utwórz pierwszą licencję, aby aktywować klienta TimeFlow i przypisać go do grupy." />
        ) : (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead><tr><th scope="col">Klucz</th><th scope="col">Plan</th><th scope="col">Status</th><th scope="col">Urządzenia</th><th scope="col">Grupa</th><th scope="col">Wygasa</th><th scope="col"><span className="sr-only">Akcje</span></th></tr></thead>
              <tbody>
                {licenses.map((license) => (
                  <tr key={license.id}>
                    <td data-label="Klucz" className="dashboard-mono">{license.licenseKey}</td>
                    <td data-label="Plan">{license.plan.toUpperCase()}</td>
                    <td data-label="Status"><span className={`dashboard-status-badge dashboard-status-badge--${licenseTone(license.status)}`}>{license.status}</span></td>
                    <td data-label="Urządzenia">{license.activeDevices.length}/{license.maxDevices}</td>
                    <td data-label="Grupa">{groups.find(({ id }) => id === license.groupId)?.name ?? license.groupId.slice(0, 8)}</td>
                    <td data-label="Wygasa">{formatDashboardDate(license.expiresAt)}</td>
                    <td data-label="Akcje" className="dashboard-table-actions"><DeleteLicenseButton licenseId={license.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
