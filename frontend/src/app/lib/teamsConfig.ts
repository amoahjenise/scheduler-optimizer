const TEAMS_STORAGE_KEY = "patient_teams";

export const DEFAULT_TEAMS = [
  "Heme-Onc",
  "ENT",
  "Pink",
  "Blue",
  "Psych",
  "Renal",
];

function normalizeTeams(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_TEAMS];

  const cleaned = value
    .map((team) => (typeof team === "string" ? team.trim() : ""))
    .filter((team) => team.length > 0);

  if (!cleaned.length) return [...DEFAULT_TEAMS];

  return Array.from(new Set(cleaned));
}

export function loadTeams(): string[] {
  if (typeof window === "undefined") return [...DEFAULT_TEAMS];

  try {
    const raw = localStorage.getItem(TEAMS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_TEAMS];
    return normalizeTeams(JSON.parse(raw));
  } catch {
    return [...DEFAULT_TEAMS];
  }
}

export function saveTeams(teams: string[]): string[] {
  const normalized = normalizeTeams(teams);
  if (typeof window !== "undefined") {
    localStorage.setItem(TEAMS_STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("teamsConfigChanged"));
  }
  return normalized;
}

export function addTeam(team: string): string[] {
  const next = [...loadTeams(), team];
  return saveTeams(next);
}

export function removeTeam(teamToRemove: string): string[] {
  const next = loadTeams().filter((team) => team !== teamToRemove);
  return saveTeams(next);
}

export function resetTeams(): string[] {
  return saveTeams([...DEFAULT_TEAMS]);
}
