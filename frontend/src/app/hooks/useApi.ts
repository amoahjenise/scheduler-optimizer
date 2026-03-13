"use client";

import { useCallback } from "react";
import { useOrganization } from "../context/OrganizationContext";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL!;

/**
 * Hook to get API fetch function with auth headers
 */
export function useAuthFetch() {
  const { getAuthHeaders } = useOrganization();

  const authFetch = useCallback(
    async (url: string, options: RequestInit = {}): Promise<Response> => {
      const headers = await getAuthHeaders();

      // Merge headers - don't override Content-Type for FormData
      const mergedHeaders = {
        ...headers,
        ...options.headers,
      };

      // Remove Content-Type for FormData (browser sets it automatically with boundary)
      if (options.body instanceof FormData) {
        delete mergedHeaders["Content-Type"];
      }

      return fetch(url, {
        ...options,
        headers: mergedHeaders,
      });
    },
    [getAuthHeaders],
  );

  return authFetch;
}

/**
 * Hook for nurse-related API calls with auth
 */
export function useNurseApi() {
  const authFetch = useAuthFetch();

  const listNurses = useCallback(
    async (
      params: { page?: number; pageSize?: number; search?: string } = {},
    ) => {
      const searchParams = new URLSearchParams();
      if (params.page) searchParams.set("page", params.page.toString());
      if (params.pageSize)
        searchParams.set("page_size", params.pageSize.toString());
      if (params.search) searchParams.set("search", params.search);

      const res = await authFetch(`${API_BASE}/nurses?${searchParams}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to fetch nurses");
      }
      return res.json();
    },
    [authFetch],
  );

  const createNurse = useCallback(
    async (data: {
      name: string;
      employee_id?: string;
      phone?: string;
      email?: string;
    }) => {
      const res = await authFetch(`${API_BASE}/nurses`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to create nurse");
      }
      return res.json();
    },
    [authFetch],
  );

  const updateNurse = useCallback(
    async (
      nurseId: string,
      data: Partial<{
        name: string;
        employee_id?: string;
        phone?: string;
        email?: string;
      }>,
    ) => {
      const res = await authFetch(`${API_BASE}/nurses/${nurseId}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to update nurse");
      }
      return res.json();
    },
    [authFetch],
  );

  const deleteNurse = useCallback(
    async (nurseId: string) => {
      const res = await authFetch(`${API_BASE}/nurses/${nurseId}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to delete nurse");
      }
    },
    [authFetch],
  );

  return { listNurses, createNurse, updateNurse, deleteNurse };
}

/**
 * Hook for patient-related API calls with auth
 */
export function usePatientApi() {
  const authFetch = useAuthFetch();

  const listPatients = useCallback(
    async (
      params: {
        skip?: number;
        limit?: number;
        activeOnly?: boolean;
        search?: string;
      } = {},
    ) => {
      const searchParams = new URLSearchParams();
      if (params.skip !== undefined)
        searchParams.set("skip", params.skip.toString());
      if (params.limit !== undefined)
        searchParams.set("limit", params.limit.toString());
      if (params.activeOnly !== undefined)
        searchParams.set("active_only", params.activeOnly.toString());
      if (params.search) searchParams.set("search", params.search);

      const res = await authFetch(`${API_BASE}/patients?${searchParams}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to fetch patients");
      }
      return res.json();
    },
    [authFetch],
  );

  const createPatient = useCallback(
    async (data: any) => {
      const res = await authFetch(`${API_BASE}/patients`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to create patient");
      }
      return res.json();
    },
    [authFetch],
  );

  return { listPatients, createPatient };
}

/**
 * Hook for handover-related API calls with auth
 */
export function useHandoverApi() {
  const authFetch = useAuthFetch();

  const listHandovers = useCallback(
    async (
      params: {
        shiftDate?: string;
        shiftType?: string;
        isCompleted?: boolean;
      } = {},
    ) => {
      const searchParams = new URLSearchParams();
      if (params.shiftDate) searchParams.set("shift_date", params.shiftDate);
      if (params.shiftType) searchParams.set("shift_type", params.shiftType);
      if (params.isCompleted !== undefined)
        searchParams.set("is_completed", params.isCompleted.toString());

      const res = await authFetch(`${API_BASE}/handovers?${searchParams}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to fetch handovers");
      }
      return res.json();
    },
    [authFetch],
  );

  const getTodaysHandovers = useCallback(
    async (shiftType?: string) => {
      const searchParams = new URLSearchParams();
      if (shiftType) searchParams.set("shift_type", shiftType);

      const res = await authFetch(
        `${API_BASE}/handovers/today?${searchParams}`,
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to fetch today's handovers");
      }
      return res.json();
    },
    [authFetch],
  );

  const createHandover = useCallback(
    async (data: any) => {
      const res = await authFetch(`${API_BASE}/handovers`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to create handover");
      }
      return res.json();
    },
    [authFetch],
  );

  const completeHandover = useCallback(
    async (handoverId: string, incomingNurse: string) => {
      const res = await authFetch(
        `${API_BASE}/handovers/${handoverId}/complete`,
        {
          method: "POST",
          body: JSON.stringify({ incoming_nurse: incomingNurse }),
        },
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to complete handover");
      }
      return res.json();
    },
    [authFetch],
  );

  return {
    listHandovers,
    getTodaysHandovers,
    createHandover,
    completeHandover,
  };
}

/**
 * Hook for schedule-related API calls with auth
 */
export function useScheduleApi() {
  const authFetch = useAuthFetch();
  const { getAuthHeaders, currentOrganization } = useOrganization();

  const createSchedule = useCallback(
    async (
      screenshots: File[],
      startDate: string,
      endDate: string,
      notes: string,
      rules: string,
      autoComments: string,
      userId: string,
    ) => {
      const formData = new FormData();

      function parseRulesInput(
        rulesText: string,
      ): Record<string, number | string> {
        const lines = rulesText.split("\n");
        const rulesObj: Record<string, number | string> = {};
        for (const line of lines) {
          const [key, value] = line.split("=").map((part) => part.trim());
          if (key && value !== undefined) {
            const numeric = Number(value);
            rulesObj[key] = isNaN(numeric) ? value : numeric;
          }
        }
        return rulesObj;
      }

      function parseAutoComments(input: string) {
        const lines = input.trim().split("\n");
        const result: Record<string, Record<string, string>> = {};
        for (const line of lines) {
          if (!line.includes("|")) continue;
          const [name, date, comment] = line
            .split("|")
            .map((part) => part.trim());
          if (!name || !date || !comment) continue;
          if (!result[name]) result[name] = {};
          result[name][date] = comment;
        }
        return result;
      }

      formData.append("period", `${startDate} to ${endDate}`);
      formData.append("user_id", userId);
      formData.append("notes", notes);
      formData.append("rules", JSON.stringify(parseRulesInput(rules)));
      formData.append(
        "employee_comments",
        autoComments.trim()
          ? JSON.stringify(parseAutoComments(autoComments))
          : "{}",
      );

      screenshots.forEach((file) => {
        formData.append("raw_images", file);
      });

      const res = await authFetch(`${API_BASE}/schedules/`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to create schedule");
      }

      return res.json();
    },
    [authFetch],
  );

  return { createSchedule };
}
