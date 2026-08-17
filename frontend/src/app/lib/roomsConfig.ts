import { DEFAULT_ROOMS, loadCachedRooms } from "./orgConfig";

export { DEFAULT_ROOMS };

export function loadRooms(
  orgId?: string | null,
  strictWhenOrg = false,
): string[] {
  return loadCachedRooms(orgId, { strictWhenOrg });
}
