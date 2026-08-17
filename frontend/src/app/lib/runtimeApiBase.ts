const DEFAULT_BACKEND_BASE = "http://localhost:8000";

export function getApiBase(): string {
  const configuredBackendBase = (
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.FASTAPI_BACKEND_URL ||
    DEFAULT_BACKEND_BASE
  ).replace(/\/$/, "");

  if (typeof window !== "undefined") {
    return "/api";
  }

  return configuredBackendBase;
}
