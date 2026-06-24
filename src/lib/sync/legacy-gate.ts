/**
 * Legacy direct-sync (snapshot → Postgres serwera) łamie inwariant server-blind:
 * serwer widziałby plaintext całej bazy. Domyślnie WYŁĄCZONE w produkcji; włącz
 * jawnie tylko do migracji/debugowania przez SYNC_ENABLE_LEGACY_DIRECT=true.
 */
export function isLegacyDirectSyncEnabled(): boolean {
  const flag = process.env.SYNC_ENABLE_LEGACY_DIRECT?.trim().toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  // Brak jawnej flagi: dozwolone poza prod, zablokowane w prod.
  return process.env.NODE_ENV !== "production";
}
