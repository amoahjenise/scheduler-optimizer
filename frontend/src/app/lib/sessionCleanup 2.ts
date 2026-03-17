/**
 * HIPAA session cleanup — removes all cached patient data from browser storage.
 * Must be called on every logout path (manual sign-out, inactivity timeout, etc.).
 */

const SENSITIVE_KEYS = [
  "patientConfig",
  "roomsConfig",
  "teamsConfig",
  "shiftCodesConfig",
  "lastSelectedPatient",
  "handoverDraft",
];

export function clearSensitiveData(): void {
  // Clear specific sensitive keys from localStorage
  for (const key of SENSITIVE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // localStorage may be unavailable in some contexts
    }
  }

  // Clear all sessionStorage (short-lived session data)
  try {
    sessionStorage.clear();
  } catch {
    // Ignore
  }

  // Clear any in-memory caches via custom event
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("hipaa-session-clear"));
  }
}
