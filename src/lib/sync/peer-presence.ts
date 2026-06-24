/** Freshness window for "online" — mirrors the existing check in direct-sync.ts. */
export const PEER_PRESENCE_WINDOW_MS = 5 * 60 * 1000;

export interface PresenceDevice {
  deviceId: string;
  lastSeenAt: string | null;
}

/**
 * True when at least one device OTHER than `excludeDeviceId` was seen within
 * `windowMs` before `nowMs`. Gates online-sync session creation so a solo device
 * never parks a master session waiting for a peer that is offline.
 * Boundary is exclusive (lastSeenAt must be strictly newer than now - window).
 */
export function isPeerPresent(
  devices: PresenceDevice[],
  excludeDeviceId: string,
  nowMs: number,
  windowMs: number = PEER_PRESENCE_WINDOW_MS,
): boolean {
  const threshold = nowMs - windowMs;
  return devices.some(
    (d) =>
      d.deviceId !== excludeDeviceId &&
      d.lastSeenAt != null &&
      new Date(d.lastSeenAt).getTime() > threshold,
  );
}
