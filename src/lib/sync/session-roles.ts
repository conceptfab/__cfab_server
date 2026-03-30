export function resolveRole(
  existingMasterDeviceId: string | null,
  newDeviceId: string,
): "master" | "slave" {
  if (!existingMasterDeviceId) return "master";
  if (existingMasterDeviceId === newDeviceId) return "master";
  return "slave";
}
