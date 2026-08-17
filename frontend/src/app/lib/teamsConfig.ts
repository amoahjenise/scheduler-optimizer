import { DEFAULT_TEAMS, loadCachedTeams } from "./orgConfig";

export { DEFAULT_TEAMS };

export function loadTeams(
  orgId?: string | null,
  strictWhenOrg = false,
): string[] {
  return loadCachedTeams(orgId, { strictWhenOrg });
}
