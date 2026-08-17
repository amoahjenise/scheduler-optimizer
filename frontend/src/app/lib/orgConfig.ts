import {
  fetchOrganizationConfigOptionsAPI,
  updateOrganizationConfigOptionsAPI,
  type OrganizationConfigOptions,
} from "./api";

export const DEFAULT_TEAMS = [
  "Heme-Onc",
  "ENT",
  "Pink",
  "Blue",
  "Psych",
  "Renal",
];

export const DEFAULT_ROOMS = [
  "B7.01",
  "B7.02",
  "B7.03",
  "B7.04",
  "B7.05",
  "B7.06",
  "B7.07",
  "B7.08",
  "B7.09",
  "B7.10",
  "B7.11",
  "B7.12",
  "B7.13",
  "B7.14",
  "B7.15",
  "B7.16",
];

const TEAMS_CACHE_PREFIX = "org_team_options";
const ROOMS_CACHE_PREFIX = "org_room_options";

type CacheReadOptions = {
  strictWhenOrg?: boolean;
};

function normalizedUnique(values: unknown, defaults: string[]): string[] {
  if (!Array.isArray(values)) return [...defaults];

  const cleaned = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);

  if (!cleaned.length) return [...defaults];

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const item of cleaned) {
    const key = item.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function teamsCacheKey(orgId?: string | null): string {
  return `${TEAMS_CACHE_PREFIX}:${orgId || "global"}`;
}

function roomsCacheKey(orgId?: string | null): string {
  return `${ROOMS_CACHE_PREFIX}:${orgId || "global"}`;
}

function readCachedList(
  key: string,
  defaults: string[],
  failClosed: boolean,
): string[] {
  if (typeof window === "undefined") return [...defaults];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return failClosed ? [] : [...defaults];
    return normalizedUnique(JSON.parse(raw), defaults);
  } catch {
    return failClosed ? [] : [...defaults];
  }
}

function writeCachedList(key: string, values: string[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(values));
}

function broadcastConfigUpdates(
  orgId: string,
  config: OrganizationConfigOptions,
): void {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent("orgConfigChanged", {
      detail: {
        organizationId: orgId,
        teamOptions: config.team_options,
        roomOptions: config.room_options,
      },
    }),
  );
  window.dispatchEvent(new CustomEvent("teamsConfigChanged"));
  window.dispatchEvent(new CustomEvent("roomsConfigChanged"));
}

function isConfigOptionsEndpointMissing(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("404") || message.includes("not found");
}

export function loadCachedTeams(
  orgId?: string | null,
  options: CacheReadOptions = {},
): string[] {
  const failClosed = Boolean(orgId) && options.strictWhenOrg === true;
  return readCachedList(teamsCacheKey(orgId), DEFAULT_TEAMS, failClosed);
}

export function loadCachedRooms(
  orgId?: string | null,
  options: CacheReadOptions = {},
): string[] {
  const failClosed = Boolean(orgId) && options.strictWhenOrg === true;
  return readCachedList(roomsCacheKey(orgId), DEFAULT_ROOMS, failClosed);
}

export async function fetchAndCacheOrganizationConfig(
  orgId: string,
  headers?: Record<string, string>,
): Promise<OrganizationConfigOptions> {
  let data: OrganizationConfigOptions;
  try {
    data = await fetchOrganizationConfigOptionsAPI(orgId, headers);
  } catch (error) {
    if (!isConfigOptionsEndpointMissing(error)) {
      throw error;
    }

    // Backward compatibility for older backend instances that don't expose
    // org config options yet.
    const fallback: OrganizationConfigOptions = {
      team_options: loadCachedTeams(orgId),
      room_options: loadCachedRooms(orgId),
    };
    writeCachedList(teamsCacheKey(orgId), fallback.team_options);
    writeCachedList(roomsCacheKey(orgId), fallback.room_options);
    return fallback;
  }

  const normalized: OrganizationConfigOptions = {
    team_options: normalizedUnique(data.team_options, DEFAULT_TEAMS),
    room_options: normalizedUnique(data.room_options, DEFAULT_ROOMS),
  };

  writeCachedList(teamsCacheKey(orgId), normalized.team_options);
  writeCachedList(roomsCacheKey(orgId), normalized.room_options);
  broadcastConfigUpdates(orgId, normalized);

  return normalized;
}

export async function updateAndCacheOrganizationConfig(
  orgId: string,
  payload: Partial<OrganizationConfigOptions>,
  headers?: Record<string, string>,
): Promise<OrganizationConfigOptions> {
  const nextPayload: Partial<OrganizationConfigOptions> = {};
  if (payload.team_options) {
    nextPayload.team_options = normalizedUnique(
      payload.team_options,
      DEFAULT_TEAMS,
    );
  }
  if (payload.room_options) {
    nextPayload.room_options = normalizedUnique(
      payload.room_options,
      DEFAULT_ROOMS,
    );
  }

  let data: OrganizationConfigOptions;
  try {
    data = await updateOrganizationConfigOptionsAPI(
      orgId,
      nextPayload,
      headers,
    );
  } catch (error) {
    if (!isConfigOptionsEndpointMissing(error)) {
      throw error;
    }

    throw new Error(
      "Organization config endpoint is unavailable. Restart backend and ensure latest organization routes are loaded.",
    );
  }

  const normalized: OrganizationConfigOptions = {
    team_options: normalizedUnique(data.team_options, DEFAULT_TEAMS),
    room_options: normalizedUnique(data.room_options, DEFAULT_ROOMS),
  };

  writeCachedList(teamsCacheKey(orgId), normalized.team_options);
  writeCachedList(roomsCacheKey(orgId), normalized.room_options);
  broadcastConfigUpdates(orgId, normalized);

  return normalized;
}
