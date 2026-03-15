"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { Calendar, FileText, RefreshCw, User } from "lucide-react";
import {
  fetchPatientsAPI,
  fetchTodaysHandoversAPI,
  fetchOptimizedSchedulesAPI,
  fetchDeletionActivitiesAPI,
  type Handover,
  type OptimizedSchedule,
  type Patient,
  type DeletionActivity,
} from "../lib/api";
import { useOrganization } from "../context/OrganizationContext";
import { FEATURES } from "../lib/featureFlags";

type RecentActivityItem = {
  id: string;
  type: "handover" | "schedule" | "patient";
  title: string;
  subtitle: string;
  timestamp: number;
};

export default function ActivitiesPage() {
  const { user } = useUser();
  const { getAuthHeaders, isLoading: orgLoading } = useOrganization();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activities, setActivities] = useState<RecentActivityItem[]>([]);

  useEffect(() => {
    async function loadActivities() {
      setLoading(true);
      setError(null);
      try {
        const authHeaders = await getAuthHeaders();

        const [
          patientsRes,
          dayHandovers,
          nightHandovers,
          schedulesList,
          deletionActivities,
        ] = await Promise.all([
          fetchPatientsAPI({ active_only: true }),
          fetchTodaysHandoversAPI("day"),
          fetchTodaysHandoversAPI("night"),
          fetchOptimizedSchedulesAPI(authHeaders),
          fetchDeletionActivitiesAPI(authHeaders, 100),
        ]);

        const activePatientIds = new Set(
          (patientsRes.patients || []).map((p: Patient) => p.id),
        );

        const activeHandoversDay = (dayHandovers.handovers || []).filter(
          (h: Handover) => activePatientIds.has(h.patient_id),
        );
        const activeHandoversNight = (nightHandovers.handovers || []).filter(
          (h: Handover) => activePatientIds.has(h.patient_id),
        );

        const handoverActivities: RecentActivityItem[] = [
          ...activeHandoversDay,
          ...activeHandoversNight,
        ].map((handover) => ({
          id: `handover-${handover.id}`,
          type: "handover",
          title: `Hand-off completed by ${handover.outgoing_nurse}`,
          subtitle: `${handover.shift_type === "day" ? "Day" : "Night"} shift • ${new Date(handover.shift_date).toLocaleDateString()}`,
          timestamp: new Date(handover.shift_date).getTime(),
        }));

        const patientActivities: RecentActivityItem[] = (
          patientsRes.patients || []
        ).map((patient: Patient) => ({
          id: `patient-${patient.id}`,
          type: "patient",
          title: `Patient added: ${patient.last_name}, ${patient.first_name}`,
          subtitle: `Room ${patient.room_number}${patient.bed ? ` • Bed ${patient.bed}` : ""}`,
          timestamp: new Date(patient.created_at).getTime(),
        }));

        const formatSchedulePeriod = (schedule: OptimizedSchedule) => {
          const rawData =
            typeof schedule.schedule_data === "string"
              ? (() => {
                  try {
                    return JSON.parse(schedule.schedule_data);
                  } catch {
                    return {};
                  }
                })()
              : (schedule.schedule_data ?? {});

          const data =
            rawData && typeof rawData === "object"
              ? (rawData as Record<string, any>)
              : {};
          const draftState =
            data.draft_state && typeof data.draft_state === "object"
              ? (data.draft_state as Record<string, any>)
              : {};

          const startRaw =
            draftState.startDate ||
            schedule.start_date ||
            data.start_date ||
            data?.dateRange?.start;
          const endRaw =
            draftState.endDate ||
            schedule.end_date ||
            data.end_date ||
            data?.dateRange?.end;

          const fallbackDates = Array.isArray(data.dates)
            ? data.dates
            : Array.isArray(draftState.ocrDates)
              ? draftState.ocrDates
              : [];
          const start = startRaw || fallbackDates[0];
          const end = endRaw || fallbackDates[fallbackDates.length - 1];

          if (!start || !end) return "Schedule period unavailable";

          const startDate = new Date(
            /^\d{4}-\d{2}-\d{2}$/.test(start) ? `${start}T00:00:00` : start,
          );
          const endDate = new Date(
            /^\d{4}-\d{2}-\d{2}$/.test(end) ? `${end}T00:00:00` : end,
          );
          if (
            Number.isNaN(startDate.getTime()) ||
            Number.isNaN(endDate.getTime())
          ) {
            return "Schedule period unavailable";
          }

          return `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
        };

        const scheduleActivities: RecentActivityItem[] = (
          Array.isArray(schedulesList) ? schedulesList : []
        ).map((schedule) => ({
          id: `schedule-${schedule.id}`,
          type: "schedule",
          title: `${schedule.is_finalized ? "Schedule finalized" : "Draft schedule saved"}: ${formatSchedulePeriod(schedule)}`,
          subtitle: `Created ${new Date(schedule.created_at).toLocaleDateString()}`,
          timestamp: new Date(schedule.created_at).getTime(),
        }));

        const deletionRecentActivities: RecentActivityItem[] = (
          Array.isArray(deletionActivities) ? deletionActivities : []
        ).map((activity: DeletionActivity) => ({
          id: `deletion-${activity.id}`,
          type: activity.object_type,
          title: `${activity.object_type === "patient" ? "Patient" : activity.object_type === "schedule" ? "Schedule" : "Hand-off"} deleted: ${activity.object_label}`,
          subtitle: `Deleted by ${activity.performed_by_name || "Unknown user"}${activity.details ? ` • ${activity.details}` : ""}`,
          timestamp: new Date(activity.occurred_at).getTime(),
        }));

        setActivities(
          [
            ...(FEATURES.PATIENT_MANAGEMENT ? patientActivities : []),
            ...handoverActivities,
            ...scheduleActivities,
            ...deletionRecentActivities,
          ].sort((a, b) => b.timestamp - a.timestamp),
        );
      } catch (err) {
        console.error("Failed to load activities:", err);
        setError("Failed to load activities");
      } finally {
        setLoading(false);
      }
    }

    if (user?.id && !orgLoading) {
      loadActivities();

      // Auto-refresh every 30 seconds
      const interval = setInterval(() => {
        loadActivities();
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [user?.id, orgLoading, getAuthHeaders]);

  return (
    <div className="page-frame">
      <div className="page-container py-8">
        <Link
          href="/dashboard"
          className="text-sm text-blue-600 hover:underline mb-1 inline-block"
        >
          ← Back to Dashboard
        </Link>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              All Recent Activity
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Latest updates across patients, hand-offs, schedules, and
              deletions
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        ) : activities.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
            No recent activity yet.
          </div>
        ) : (
          <div className="space-y-2.5">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-center gap-3 p-3 bg-white border border-gray-100 rounded-xl"
              >
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    activity.type === "schedule"
                      ? "bg-purple-100"
                      : activity.type === "patient"
                        ? "bg-emerald-100"
                        : "bg-blue-100"
                  }`}
                >
                  {activity.type === "schedule" ? (
                    <Calendar className="w-4 h-4 text-purple-600" />
                  ) : activity.type === "patient" ? (
                    <User className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <FileText className="w-4 h-4 text-blue-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {activity.title}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {activity.subtitle}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
