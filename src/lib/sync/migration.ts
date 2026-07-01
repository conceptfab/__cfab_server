// Fleet migration (v1 → v2) readiness — pure logic, no I/O so it is unit-testable.
//
// A group is "v2-ready" when EVERY active device (seen within the window) has
// reported E2E v2 capability (a group passphrase is set). Only then is it safe to
// accept v2 packages for the group without a not-yet-migrated device failing to
// decrypt on pull.

export interface DeviceV2Signal {
  /** ISO timestamp of last activity. */
  lastSeenAt: string;
  /** Whether the device reported v2 capability. */
  supportsV2: boolean;
}

export interface GroupV2Status {
  activeDevices: number;
  v2Capable: number;
  /** True iff there is ≥1 active device AND all active devices are v2-capable. */
  allV2: boolean;
}

/** Active window: a device counts as "in the fleet" if seen within 30 days. */
export const V2_ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function computeGroupV2Readiness(
  devices: DeviceV2Signal[],
  now: number = Date.now(),
  windowMs: number = V2_ACTIVE_WINDOW_MS,
): GroupV2Status {
  const cutoff = now - windowMs;
  const active = devices.filter((d) => {
    const t = new Date(d.lastSeenAt).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
  const v2Capable = active.filter((d) => d.supportsV2).length;
  return {
    activeDevices: active.length,
    v2Capable,
    allV2: active.length > 0 && v2Capable === active.length,
  };
}
