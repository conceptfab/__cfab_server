export const runtime = "nodejs";

import { clearDirectSyncHistory } from "@/lib/sync/direct-sync";
import { handleAdminDelete, handleAdminOptions } from "@/lib/sync/admin-http";

export async function OPTIONS() {
  return handleAdminOptions();
}

export async function DELETE(request: Request) {
  return handleAdminDelete(request, "admin-sync-history-clear", async () => {
    const result = await clearDirectSyncHistory();
    return { ok: true as const, deleted: result.cleared > 0, cleared: result.cleared };
  });
}
