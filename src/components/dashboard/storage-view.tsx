import {
  CreateStorageBackendForm,
  DeleteStorageBackendButton,
  EditStorageBackendButton,
  TestStorageBackendButton,
} from "@/components/storage-backend-form";
import type { StorageBackendConfig } from "@/lib/sync/license-contracts";

import { DashboardEmptyState, DashboardPageHeader, formatDashboardDate } from "./dashboard-ui";

function storageLocation(storage: StorageBackendConfig) {
  if (storage.type === "sftp" || storage.type === "ftp") return `${storage.host}:${storage.port}`;
  if (storage.type === "aws-s3") return storage.bucket;
  return "Lokalny";
}

export function StorageView({ storageBackends }: { storageBackends: StorageBackendConfig[] }) {
  return (
    <>
      <DashboardPageHeader
        title="Storage"
        description="Backendy plików sesji, limity i testy połączenia."
        action={<CreateStorageBackendForm />}
      />
      <section className="dashboard-resource-panel">
        {storageBackends.length === 0 ? (
          <DashboardEmptyState symbol="▤" title="Brak dodatkowych backendów storage" description="Dodaj SFTP, FTP lub AWS S3, aby serwer mógł przechowywać pliki sesji synchronizacji." />
        ) : (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead><tr><th scope="col">Nazwa</th><th scope="col">Typ</th><th scope="col">Host / bucket</th><th scope="col">Base path</th><th scope="col">Maks. plik</th><th scope="col">TTL sesji</th><th scope="col">Utworzony</th><th scope="col"><span className="sr-only">Akcje</span></th></tr></thead>
              <tbody>
                {storageBackends.map((storage) => (
                  <tr key={storage.id}>
                    <td data-label="Nazwa"><strong>{storage.name}</strong><small className="dashboard-mono">{storage.id.slice(0, 8)}</small></td>
                    <td data-label="Typ"><span className="dashboard-status-badge dashboard-status-badge--info">{storage.type.toUpperCase()}</span></td>
                    <td data-label="Host / bucket" className="dashboard-mono">{storageLocation(storage)}</td>
                    <td data-label="Base path" className="dashboard-mono">{storage.basePath}</td>
                    <td data-label="Maks. plik">{storage.maxFileSizeMb} MB</td>
                    <td data-label="TTL sesji">{storage.sessionTtlMinutes} min</td>
                    <td data-label="Utworzony">{formatDashboardDate(storage.createdAt)}</td>
                    <td data-label="Akcje"><div className="dashboard-table-actions"><EditStorageBackendButton backendId={storage.id} current={{ name: storage.name, basePath: storage.basePath, host: "host" in storage ? storage.host : undefined, port: "port" in storage ? storage.port : undefined, username: "username" in storage ? storage.username : undefined, maxFileSizeMb: storage.maxFileSizeMb, sessionTtlMinutes: storage.sessionTtlMinutes, type: storage.type }} /><TestStorageBackendButton backendId={storage.id} /><DeleteStorageBackendButton backendId={storage.id} /></div></td>
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
