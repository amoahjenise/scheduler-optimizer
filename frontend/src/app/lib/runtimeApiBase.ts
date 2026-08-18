const DEFAULT_BACKEND_BASE = "http://localhost:8000";

export function getApiBase(): string {
  const publicBackendBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();
  const serverBackendBase = (process.env.FASTAPI_BACKEND_URL || "").trim();
  const configuredBackendBase = (
    publicBackendBase ||
    serverBackendBase ||
    DEFAULT_BACKEND_BASE
  ).replace(/\/$/, "");

  if (typeof window !== "undefined") {
    // In local development, calling FastAPI directly avoids an extra hop
    // through Next API proxy for every request and keeps page transitions snappy.
    if (process.env.NODE_ENV !== "production") {
      return configuredBackendBase;
    }

    return "/api";
  }

  return configuredBackendBase;
}
