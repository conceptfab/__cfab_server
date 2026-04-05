export const runtime = "nodejs";

import { clearAllSessions } from "@/lib/sync/session-store";
import { handleAdminDelete, handleAdminOptions } from "@/lib/sync/admin-http";

export async function OPTIONS() {
  return handleAdminOptions();
}

export async function DELETE(request: Request) {
  return handleAdminDelete(request, "admin-sync-sessions-clear", async () => {
    const result = await clearAllSessions();
    return { ok: true as const, deleted: result.cleared > 0, cleared: result.cleared };
  });
}
