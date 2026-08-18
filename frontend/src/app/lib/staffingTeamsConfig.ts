import {
  DEFAULT_STAFFING_TEAMS,
  loadCachedStaffingTeams,
} from "./orgConfig";

export { DEFAULT_STAFFING_TEAMS };

export function loadStaffingTeams(
  orgId?: string | null,
  strictWhenOrg = false,
): string[] {
  return loadCachedStaffingTeams(orgId, { strictWhenOrg });
}
