import { CreateGroupForm } from "@/components/group-form";
import { GroupBackendSelector } from "@/components/storage-backend-form";
import type { ClientGroup, License, StorageBackendConfig } from "@/lib/sync/license-contracts";

import { DashboardEmptyState, DashboardPageHeader } from "./dashboard-ui";

export function GroupsView({
  groups,
  storageBackends,
  licenses,
}: {
  groups: ClientGroup[];
  storageBackends: StorageBackendConfig[];
  licenses: License[];
}) {
  const backendOptions = storageBackends.map(({ id, name, type }) => ({ id, name: `${name} (${type})` }));
  return (
    <>
      <DashboardPageHeader
        title="Grupy"
        description="Przypisania licencji, storage i urządzenia master."
        action={<CreateGroupForm licenses={licenses.map(({ id, licenseKey, plan }) => ({ id, licenseKey, plan }))} storageBackends={storageBackends.map(({ id, name, type }) => ({ id, name, type }))} />}
      />
      <section className="dashboard-resource-panel">
        {groups.length === 0 ? (
          <DashboardEmptyState symbol="◎" title="Brak grup klientów" description="Grupa łączy licencję, urządzenia oraz backend storage w jeden obszar synchronizacji." />
        ) : (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead><tr><th scope="col">Nazwa</th><th scope="col">Owner</th><th scope="col">Storage</th><th scope="col">Fixed master</th><th scope="col">Maks. sync</th><th scope="col">Maks. DB</th></tr></thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.id}>
                    <td data-label="Nazwa"><strong>{group.name}</strong><small className="dashboard-mono">{group.id.slice(0, 8)}</small></td>
                    <td data-label="Owner">{group.ownerId}</td>
                    <td data-label="Storage"><GroupBackendSelector groupId={group.id} currentBackendId={group.storageBackendId} backends={backendOptions} /></td>
                    <td data-label="Fixed master" className="dashboard-mono">{group.fixedMasterDeviceId?.slice(0, 10) ?? "—"}</td>
                    <td data-label="Maks. sync">{group.maxSyncFrequencyHours == null ? "—" : `${group.maxSyncFrequencyHours} h`}</td>
                    <td data-label="Maks. DB">{group.maxDatabaseSizeMb == null ? "—" : `${group.maxDatabaseSizeMb} MB`}</td>
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
