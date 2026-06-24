// SSE Event Bus — notifies connected clients when new sync data is available.
// In-memory only (single-process): on Vercel serverless this does NOT broadcast
// across function instances, so clients rely on polling /api/sync/status. Kept as
// a single-instance fast-path; `notifyPeers` is currently unused.

export interface SyncEvent {
  type: "sync_available";
  userId: string;
  sourceDeviceId: string;
  revision: number;
  reason: string;
  timestamp: string;
}

type Listener = (event: SyncEvent) => void;

interface ClientEntry {
  userId: string;
  deviceId: string;
  listener: Listener;
}

const clients = new Map<string, ClientEntry>();

function clientKey(userId: string, deviceId: string): string {
  return `${userId}::${deviceId}`;
}

export function subscribe(
  userId: string,
  deviceId: string,
  listener: Listener,
): () => void {
  const key = clientKey(userId, deviceId);
  clients.set(key, { userId, deviceId, listener });
  return () => {
    clients.delete(key);
  };
}

export function notifyPeers(event: SyncEvent): void {
  for (const [, client] of clients) {
    // Only notify devices of the same user, excluding the source device
    if (client.userId === event.userId && client.deviceId !== event.sourceDeviceId) {
      try {
        client.listener(event);
      } catch {
        // Listener threw — ignore (connection likely closed)
      }
    }
  }
}

export function getConnectedCount(userId: string): number {
  let count = 0;
  for (const [, client] of clients) {
    if (client.userId === userId) count++;
  }
  return count;
}

export function getConnectedDevices(userId: string): string[] {
  const devices: string[] = [];
  for (const [, client] of clients) {
    if (client.userId === userId) devices.push(client.deviceId);
  }
  return devices;
}
