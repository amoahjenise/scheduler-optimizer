"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useState, useEffect } from "react";
import {
  fetchPatientsAPI,
  fetchTodaysHandoversAPI,
  fetchOptimizedSchedulesAPI,
  fetchDeletionActivitiesAPI,
  type Handover,
  type OptimizedSchedule,
  type DeletionActivity,
} from "../lib/api";
import {
  Calendar,
  FileText,
  Users,
  ArrowRight,
  Clock,
  Activity,
  ChevronRight,
  X,
  Bed,
  User,
  RefreshCw,
  UserCheck,
} from "lucide-react";
import { useOrganization } from "../context/OrganizationContext";
import type { Patient } from "../lib/api";
import { FEATURES } from "../lib/featureFlags";

interface ScheduleShift {
  nurse: string;
  shiftType: string;
  shiftTime: string;
  hours: number;
}

interface DaySchedule {
  date: string;
  dayStaff: ScheduleShift[];
  nightStaff: ScheduleShift[];
}

interface RecentActivityItem {
  id: string;
  type: "handover" | "schedule" | "patient";
  title: string;
  subtitle: string;
  timestamp: number;
}

const RECENT_ACTIVITY_LIMIT = 3;

function parseTimeToMinutes(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (normalized % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatShiftTimeRange(shift: any): string {
  const rawTime = typeof shift?.time === "string" ? shift.time.trim() : "";
  const hasRangeInRaw = rawTime.includes("-") || rawTime.includes("–");
  if (hasRangeInRaw) return rawTime.replace(/\s*[–-]\s*/, " - ");

  const start =
    (typeof shift?.startTime === "string" ? shift.startTime.trim() : "") ||
    rawTime;
  const end = typeof shift?.endTime === "string" ? shift.endTime.trim() : "";

  if (start && end) return `${start} - ${end}`;

  const hours = Number(shift?.hours ?? 0);
  const startMinutes = start ? parseTimeToMinutes(start) : null;
  if (startMinutes !== null && hours > 0) {
    const computedEnd = minutesToTime(startMinutes + Math.round(hours * 60));
    return `${start} - ${computedEnd}`;
  }

  return start || rawTime || "";
}

export default function Dashboard() {
  const { user } = useUser();
  const {
    currentOrganization,
    isAdmin,
    getAuthHeaders,
    isLoading: orgLoading,
  } = useOrganization();
  const [stats, setStats] = useState({
    activePatients: 0,
    completedHandovers: 0,
    totalHandovers: 0,
    schedulesCreated: 0,
    finalizedSchedules: 0,
    loading: true,
  });
  const [patients, setPatients] = useState<Patient[]>([]);
  const [recentActivities, setRecentActivities] = useState<
    RecentActivityItem[]
  >([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [todaySchedule, setTodaySchedule] = useState<DaySchedule | null>(null);
  const [weekSchedules, setWeekSchedules] = useState<Map<string, DaySchedule>>(
    new Map(),
  );
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStats() {
      setStats((prev) => ({ ...prev, loading: true }));
      setRefreshError(null);

      try {
        const authHeaders = await getAuthHeaders();

        // Fetch independently so one group failing doesn't zero-out the other
        const [patientsRes, dayHandovers, nightHandovers] = await Promise.all([
          fetchPatientsAPI({ active_only: true }),
          fetchTodaysHandoversAPI("day"),
          fetchTodaysHandoversAPI("night"),
        ]);

        let schedulesList: OptimizedSchedule[] = [];
        let deletionActivities: DeletionActivity[] = [];
        try {
          [schedulesList, deletionActivities] = await Promise.all([
            fetchOptimizedSchedulesAPI(authHeaders),
            fetchDeletionActivitiesAPI(authHeaders, 25),
          ]);
        } catch (authErr) {
          console.warn("Failed to load schedule/deletion data:", authErr);
        }

        // Include ALL handovers: both linked (patient_id) and embedded (p_first_name)
        const allHandoversDay = dayHandovers.handovers || [];
        const allHandoversNight = nightHandovers.handovers || [];

        // Combine and dedupe by patient + shift (defensive guard)
        const allHandoversRaw = [...allHandoversDay, ...allHandoversNight];
        const dedupedMap = new Map<string, Handover>();
        allHandoversRaw.forEach((handover) => {
          // Build dedup key: use patient_id when available, fallback to embedded name+room
          const patientKey =
            handover.patient_id ||
            `embedded-${handover.p_first_name}-${handover.p_last_name}-${handover.p_room_number}`;
          const key = `${patientKey}-${handover.shift_type}`;
          const existing = dedupedMap.get(key);
          if (!existing) {
            dedupedMap.set(key, handover);
            return;
          }

          const existingTs = new Date(
            existing.updated_at || existing.created_at || existing.shift_date,
          ).getTime();
          const nextTs = new Date(
            handover.updated_at || handover.created_at || handover.shift_date,
          ).getTime();
          if (nextTs > existingTs) {
            dedupedMap.set(key, handover);
          }
        });

        const allHandovers = Array.from(dedupedMap.values());

        // Determine current shift based on time of day (7am-7pm = day, otherwise = night)
        const currentHour = new Date().getHours();
        const currentShift =
          currentHour >= 7 && currentHour < 19 ? "day" : "night";

        // Filter to current shift only for dashboard display
        const currentShiftHandovers = allHandovers.filter(
          (h) => h.shift_type === currentShift,
        );

        // Count completed for the current shift
        const completedHandovers = currentShiftHandovers.filter(
          (h) => h.is_completed,
        ).length;
        const totalHandovers = currentShiftHandovers.length;

        const handoverActivities: RecentActivityItem[] = allHandovers.map(
          (handover) => ({
            id: `handover-${handover.id}`,
            type: "handover",
            title: `Hand-off completed by ${handover.outgoing_nurse}`,
            subtitle: `${handover.shift_type === "day" ? "Day" : "Night"} shift • ${new Date(handover.shift_date).toLocaleDateString()}`,
            timestamp: new Date(handover.shift_date).getTime(),
          }),
        );

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

        const mergedRecentActivities = [
          ...(FEATURES.PATIENT_MANAGEMENT ? patientActivities : []),
          ...handoverActivities,
          ...scheduleActivities,
          ...deletionRecentActivities,
        ]
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, RECENT_ACTIVITY_LIMIT);

        setPatients(patientsRes.patients || []);
        setRecentActivities(mergedRecentActivities);
        setStats({
          activePatients: patientsRes.patients?.length || 0,
          completedHandovers,
          totalHandovers,
          schedulesCreated: Array.isArray(schedulesList)
            ? schedulesList.length
            : 0,
          finalizedSchedules: Array.isArray(schedulesList)
            ? schedulesList.filter((s: OptimizedSchedule) => s.is_finalized)
                .length
            : 0,
          loading: false,
        });
        setLastRefreshedAt(new Date());

        // Find schedule that includes today
        await loadTodaySchedule(schedulesList, authHeaders);
      } catch (err) {
        console.error("Failed to load stats:", err);
        setRefreshError("Refresh failed");
        setStats((prev) => ({ ...prev, loading: false }));
      }
    }

    async function loadTodaySchedule(
      schedulesList: OptimizedSchedule[],
      authHeaders: Record<string, string>,
    ) {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const toDateOnly = (value?: string) => {
          if (!value) return "";
          return value.split("T")[0];
        };

        const extractScheduleData = (schedule: OptimizedSchedule): any => {
          const raw =
            typeof schedule.schedule_data === "string"
              ? JSON.parse(schedule.schedule_data)
              : schedule.schedule_data;
          return raw && typeof raw === "object" ? raw : {};
        };

        const resolveRange = (schedule: OptimizedSchedule) => {
          const data = extractScheduleData(schedule);
          const dates = Array.isArray(data?.dates) ? data.dates : [];
          const start =
            toDateOnly(schedule.start_date) ||
            toDateOnly(data?.start_date) ||
            toDateOnly(data?.dateRange?.start) ||
            (dates.length ? toDateOnly(dates[0]) : "");
          const end =
            toDateOnly(schedule.end_date) ||
            toDateOnly(data?.end_date) ||
            toDateOnly(data?.dateRange?.end) ||
            (dates.length ? toDateOnly(dates[dates.length - 1]) : "");
          return { start, end, data };
        };

        // Find schedules that include today
        const activeSchedule = schedulesList.find((schedule) => {
          const { start: startStr, end: endStr } = resolveRange(schedule);
          if (!startStr || !endStr || !schedule.is_finalized) return false;
          const start = new Date(startStr);
          const end = new Date(endStr);
          start.setHours(0, 0, 0, 0);
          end.setHours(23, 59, 59, 999);
          return today >= start && today <= end;
        });

        if (!activeSchedule) {
          setTodaySchedule(null);
          setWeekSchedules(new Map());
          return;
        }

        // Use schedule data directly from the list response (no need for second API call)
        // Parse schedule data
        const { data: scheduleData } = resolveRange(activeSchedule);

        // Build map of dates to staff
        const weekMap = new Map<string, DaySchedule>();
        const todayStr = today.toISOString().split("T")[0];

        if (scheduleData.dates && Array.isArray(scheduleData.dates)) {
          scheduleData.dates.forEach((dateStr: string, dateIndex: number) => {
            const dayStaff: ScheduleShift[] = [];
            const nightStaff: ScheduleShift[] = [];

            const rows = Array.isArray(scheduleData.schedule)
              ? scheduleData.schedule
              : Array.isArray(scheduleData.grid)
                ? scheduleData.grid
                : [];

            // Iterate through nurses
            rows.forEach((nurseRow: any) => {
              const shift = nurseRow.shifts?.[dateIndex];
              if (!shift) return;

              const hours = Number(shift.hours ?? 0);
              if (hours <= 0) return;

              const shiftInfo: ScheduleShift = {
                nurse: nurseRow.nurse || nurseRow.name || "Unknown",
                shiftType: shift.shiftType || shift.shift || "",
                shiftTime: formatShiftTimeRange(shift),
                hours,
              };

              // Determine if day or night shift based on explicit type or time
              const isNightShift =
                shift.shiftType === "night" ||
                shift.time?.includes("19:00") ||
                shift.time?.includes("23:00") ||
                shift.startTime?.includes("19:00") ||
                shift.startTime?.includes("23:00");

              if (isNightShift) {
                nightStaff.push(shiftInfo);
              } else {
                dayStaff.push(shiftInfo);
              }
            });

            weekMap.set(dateStr, {
              date: dateStr,
              dayStaff,
              nightStaff,
            });
          });
        }

        setWeekSchedules(weekMap);
        setTodaySchedule(weekMap.get(todayStr) || null);
      } catch (err) {
        console.error("Failed to load today's schedule:", err);
        setTodaySchedule(null);
        setWeekSchedules(new Map());
      }
    }

    if (user?.id && !orgLoading) {
      loadStats();

      // Auto-refresh every 30 seconds
      const interval = setInterval(() => {
        loadStats();
      }, 30000);

      return () => clearInterval(interval);
    }

    if (!orgLoading && !user?.id) {
      setStats((prev) => ({ ...prev, loading: false }));
    }
  }, [currentOrganization, getAuthHeaders, refreshKey, user?.id, orgLoading]);

  const currentTime = new Date();
  const isDayShiftActive =
    currentTime.getHours() >= 7 && currentTime.getHours() < 19;
  const [activeShiftTab, setActiveShiftTab] = useState<"day" | "night">(
    isDayShiftActive ? "day" : "night",
  );

  useEffect(() => {
    setActiveShiftTab(isDayShiftActive ? "day" : "night");
  }, [isDayShiftActive]);

  const greeting =
    currentTime.getHours() < 12
      ? "Good morning"
      : currentTime.getHours() < 18
        ? "Good afternoon"
        : "Good evening";

  const weekDays = ["S", "M", "T", "W", "T", "F", "S"];
  const today = currentTime.getDay();

  // Generate week dates
  const getWeekDates = () => {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(currentTime);
      date.setDate(currentTime.getDate() - today + i);
      dates.push(date.getDate());
    }
    return dates;
  };
  const weekDates = getWeekDates();

  return (
    <div className="page-frame">
      <div className="page-container py-8">
        {/* Main Container Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 lg:p-7">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <p className="text-gray-400 text-sm mb-1">
                {currentTime.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </p>
              <h1 className="text-[28px] font-bold text-gray-900">
                {greeting}, {user?.firstName || "there"}
              </h1>
              <div className="mt-2">
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${
                    isDayShiftActive
                      ? "bg-amber-100 text-amber-800 border-amber-200"
                      : "bg-indigo-100 text-indigo-800 border-indigo-200"
                  }`}
                >
                  {isDayShiftActive
                    ? "☀️ Current shift: Day (7AM - 7PM)"
                    : "🌙 Current shift: Night (7PM - 7AM)"}
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <button
                onClick={() => setRefreshKey((prev) => prev + 1)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 hover:text-[#1A5CFF] hover:bg-blue-50 rounded-xl transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                disabled={stats.loading}
              >
                <RefreshCw
                  className={`w-4 h-4 ${stats.loading ? "animate-spin" : ""}`}
                />
                {stats.loading ? "Refreshing..." : "Refresh"}
              </button>
              <p className="text-[11px] text-gray-400 min-h-[16px]">
                {stats.loading
                  ? "Updating dashboard..."
                  : refreshError
                    ? refreshError
                    : lastRefreshedAt
                      ? `Updated ${lastRefreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : ""}
              </p>
            </div>
          </div>

          {/* Stats Cards Row */}
          <div
            className={`grid grid-cols-1 ${FEATURES.PATIENT_MANAGEMENT ? "md:grid-cols-3" : "md:grid-cols-2"} gap-4 mb-6`}
          >
            {/* Active Patients Card - Clickable */}
            {FEATURES.PATIENT_MANAGEMENT && (
              <Link
                href="/patients"
                className="bg-gradient-to-br from-blue-50 to-white rounded-2xl p-4 border border-blue-100 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer block"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-[#1A5CFF]/10 flex items-center justify-center">
                    <Activity className="w-5 h-5 text-[#1A5CFF]" />
                  </div>
                  <span className="text-xs font-medium text-[#1A5CFF] flex items-center gap-1">
                    View details <ChevronRight className="w-3 h-3" />
                  </span>
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-3xl font-bold text-gray-900">
                      {stats.loading ? "–" : stats.activePatients}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">Patients</p>
                  </div>
                  {/* Mini bar chart */}
                  <div className="flex items-end gap-1 h-12">
                    {[40, 65, 45, 80, 55, 70, 90].map((h, i) => (
                      <div
                        key={i}
                        className="w-2 bg-[#1A5CFF]/20 rounded-full"
                        style={{ height: `${h}%` }}
                      />
                    ))}
                  </div>
                </div>
              </Link>
            )}

            {/* Today's Hand-offs Card - Clickable */}
            <Link
              href="/handover"
              className="bg-gradient-to-br from-emerald-50 to-white rounded-2xl p-4 border border-emerald-100 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer block"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-emerald-600" />
                </div>
                <span className="text-xs font-medium text-emerald-600 flex items-center gap-1">
                  View details <ChevronRight className="w-3 h-3" />
                </span>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-3xl font-bold text-gray-900">
                    {stats.loading
                      ? "–"
                      : `${stats.completedHandovers}/${stats.totalHandovers}`}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    Hand-Offs Completed
                  </p>
                </div>
                <div className="flex items-end gap-1 h-12">
                  {[30, 50, 70, 45, 85, 60, 40].map((h, i) => (
                    <div
                      key={i}
                      className="w-2 bg-emerald-500/20 rounded-full"
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
              </div>
            </Link>

            {/* Schedules Card - Clickable */}
            <Link
              href={isAdmin ? "/admin/schedules" : "/schedules"}
              className="bg-gradient-to-br from-purple-50 to-white rounded-2xl p-4 border border-purple-100 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer block"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-purple-600" />
                </div>
                <span className="text-xs font-medium text-purple-600 flex items-center gap-1">
                  View details <ChevronRight className="w-3 h-3" />
                </span>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-3xl font-bold text-gray-900">
                    {stats.loading
                      ? "–"
                      : isAdmin
                        ? `${stats.finalizedSchedules}/${stats.schedulesCreated}`
                        : stats.finalizedSchedules}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    {isAdmin
                      ? "Finalized / Total Schedules"
                      : "Finalized Schedules"}
                  </p>
                </div>
                <div className="flex items-end gap-1 h-12">
                  {[55, 75, 35, 90, 50, 65, 80].map((h, i) => (
                    <div
                      key={i}
                      className="w-2 bg-purple-500/20 rounded-full"
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
              </div>
            </Link>
          </div>

          {/* Quick Actions - high-clarity shortcuts */}
          <div className="mb-6 bg-gray-50 border border-gray-200 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">
                Quick Actions
              </h2>
              <span className="text-xs text-gray-500">
                Most-used tasks for shift workflow
              </span>
            </div>
            <div
              className={`grid grid-cols-1 ${FEATURES.PATIENT_MANAGEMENT ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-3`}
            >
              <Link
                href="/handover?new=true"
                className="flex items-center gap-3 rounded-xl border border-blue-200 bg-white px-4 py-3 hover:bg-blue-50 hover:shadow-sm transition-all"
              >
                <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-blue-700" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    New Hand-Off
                  </p>
                  <p className="text-xs text-gray-500">
                    Create a new hand-off report
                  </p>
                </div>
              </Link>

              {FEATURES.PATIENT_MANAGEMENT && (
                <Link
                  href="/patients"
                  className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 hover:bg-emerald-50 hover:shadow-sm transition-all"
                >
                  <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <Users className="w-4 h-4 text-emerald-700" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      Patients
                    </p>
                    <p className="text-xs text-gray-500">
                      Add/edit patient info
                    </p>
                  </div>
                </Link>
              )}

              <Link
                href={isAdmin ? "/scheduler" : "/schedules"}
                className="flex items-center gap-3 rounded-xl border border-purple-200 bg-white px-4 py-3 hover:bg-purple-50 hover:shadow-sm transition-all"
              >
                <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-purple-700" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {isAdmin ? "Schedule Optimizer" : "Schedules"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {isAdmin
                      ? "Create or refine staffing plan"
                      : "Review finalized roster"}
                  </p>
                </div>
              </Link>
            </div>
          </div>

          {/* Main Content Grid - Reorganized by importance */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            {/* Left Column - Stats & Quick Access */}
            <div className="xl:col-span-8 space-y-4">
              {/* Shift Overview - Most Important */}
              <div
                className={`bg-gradient-to-br ${activeShiftTab === "day" ? "from-amber-50 to-white rounded-2xl p-5 border border-amber-100" : "from-indigo-50 to-white rounded-2xl p-5 border border-indigo-100"} shadow-sm`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl ${activeShiftTab === "day" ? "bg-amber-100" : "bg-indigo-100"} flex items-center justify-center`}
                    >
                      <Activity
                        className={`w-5 h-5 ${activeShiftTab === "day" ? "text-amber-600" : "text-indigo-600"}`}
                      />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">
                        Current Shift
                      </p>
                      <p className="text-xs text-gray-500">
                        {isDayShiftActive
                          ? "Day Shift (7AM - 7PM)"
                          : "Night Shift (7PM - 7AM)"}
                      </p>
                    </div>
                  </div>

                  {todaySchedule && (
                    <div
                      className={`inline-flex rounded-xl border ${activeShiftTab === "day" ? "border-amber-200" : "border-indigo-200"} bg-white p-1`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveShiftTab("day")}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          activeShiftTab === "day"
                            ? "bg-amber-500 text-white"
                            : "text-gray-600 hover:bg-amber-50"
                        }`}
                      >
                        ☀️ Day ({todaySchedule.dayStaff.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveShiftTab("night")}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          activeShiftTab === "night"
                            ? "bg-indigo-600 text-white"
                            : "text-gray-600 hover:bg-indigo-50"
                        }`}
                      >
                        🌙 Night ({todaySchedule.nightStaff.length})
                      </button>
                    </div>
                  )}
                </div>

                {todaySchedule ? (
                  <div className="space-y-3">
                    {(() => {
                      const activeStaff =
                        activeShiftTab === "day"
                          ? todaySchedule.dayStaff
                          : todaySchedule.nightStaff;
                      const iconColor =
                        activeShiftTab === "day"
                          ? "text-[#1A5CFF]"
                          : "text-indigo-600";

                      if (activeStaff.length === 0) {
                        return (
                          <div className="text-center py-6 bg-white rounded-xl border border-gray-100">
                            <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                            <p className="text-sm text-gray-500">
                              No staff scheduled for this shift
                            </p>
                          </div>
                        );
                      }

                      return (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {activeStaff.map((shift, idx) => (
                            <div
                              key={`${activeShiftTab}-${idx}-${shift.nurse}`}
                              className="flex items-center gap-2 p-2.5 bg-white rounded-lg border border-gray-100"
                            >
                              <UserCheck
                                className={`w-4 h-4 ${iconColor} flex-shrink-0`}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {shift.nurse}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {shift.shiftTime || `${shift.hours}h`}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm font-medium text-gray-600 mb-1">
                      No Active Schedule
                    </p>
                    <p className="text-xs text-gray-400">
                      Create a schedule to see staff assignments
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column - Week Calendar */}
            <div className="xl:col-span-4 space-y-4">
              {/* Week Calendar */}
              <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">This Week</h3>
                  <div className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-medium text-gray-600">
                    <Clock className="h-3 w-3" />
                    Live
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {weekDays.map((day, index) => {
                    const dayDate = new Date(currentTime);
                    dayDate.setDate(currentTime.getDate() - today + index);
                    const dateStr = dayDate.toISOString().split("T")[0];
                    const daySchedule = weekSchedules.get(dateStr);
                    const hasSchedule =
                      daySchedule &&
                      (daySchedule.dayStaff.length > 0 ||
                        daySchedule.nightStaff.length > 0);

                    return (
                      <div
                        key={index}
                        className="relative w-full"
                        style={{ paddingBottom: "100%" }}
                        onMouseEnter={() => setHoveredDay(index)}
                        onMouseLeave={() => setHoveredDay(null)}
                      >
                        <div
                          className={`absolute inset-0 p-2.5 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 transition-all ${
                            index === today
                              ? "border-blue-500 bg-blue-500 text-white shadow-md"
                              : hasSchedule
                                ? "border-blue-100 bg-blue-50 hover:border-blue-200 hover:bg-blue-100"
                                : "border-gray-200 bg-gray-50 hover:border-gray-300"
                          }`}
                        >
                          <span
                            className={`text-[8px] font-semibold uppercase tracking-wide mb-0.5 mt-1 ${
                              index === today
                                ? "text-blue-100"
                                : "text-gray-500"
                            }`}
                          >
                            {day}
                          </span>
                          <span
                            className={`text-base font-bold ${index === today ? "text-white" : hasSchedule ? "text-blue-600" : "text-gray-400"}`}
                          >
                            {weekDates[index]}
                          </span>
                          {hasSchedule && index !== today && (
                            <div className="mt-0.5 h-1 w-1 rounded-full bg-blue-500"></div>
                          )}
                        </div>

                        {/* Hover Tooltip */}
                        {hoveredDay === index && daySchedule && hasSchedule && (
                          <div
                            className="absolute left-1/2 top-full z-[60] mt-2 w-64 -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-3 shadow-xl"
                            onMouseEnter={() => setHoveredDay(index)}
                            onMouseLeave={() => setHoveredDay(null)}
                          >
                            <div className="text-xs font-semibold text-gray-900 mb-2">
                              {dayDate.toLocaleDateString("en-US", {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                              })}
                            </div>

                            {daySchedule.dayStaff.length > 0 && (
                              <div className="mb-2">
                                <div className="text-xs font-medium text-gray-600 mb-1">
                                  ☀️ Day ({daySchedule.dayStaff.length})
                                </div>
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                  {daySchedule.dayStaff.map((shift, idx) => (
                                    <div
                                      key={idx}
                                      className="text-xs text-gray-700 truncate flex items-center gap-1"
                                    >
                                      <div className="w-1 h-1 rounded-full bg-[#1A5CFF]"></div>
                                      {shift.nurse}{" "}
                                      <span className="text-gray-500">
                                        • {shift.shiftTime || `${shift.hours}h`}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {daySchedule.nightStaff.length > 0 && (
                              <div>
                                <div className="text-xs font-medium text-gray-600 mb-1">
                                  🌙 Night ({daySchedule.nightStaff.length})
                                </div>
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                  {daySchedule.nightStaff.map((shift, idx) => (
                                    <div
                                      key={idx}
                                      className="text-xs text-gray-700 truncate flex items-center gap-1"
                                    >
                                      <div className="w-1 h-1 rounded-full bg-indigo-600"></div>
                                      {shift.nurse}{" "}
                                      <span className="text-gray-500">
                                        • {shift.shiftTime || `${shift.hours}h`}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Recent Activity */}
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">
                    Recent Activity
                  </h3>
                  <Link
                    href="/activities"
                    className="text-xs font-medium text-[#1A5CFF] hover:underline"
                  >
                    View all
                  </Link>
                </div>
                <div className="space-y-2.5">
                  {recentActivities.length > 0 ? (
                    recentActivities.map((activity) => (
                      <div
                        key={activity.id}
                        className="flex items-center gap-2.5 p-2.5 bg-white rounded-xl"
                      >
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
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
                          <p className="text-xs text-gray-400 truncate">
                            {activity.subtitle}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-5">
                      <p className="text-sm text-gray-400">
                        No activity today yet
                      </p>
                      <Link
                        href="/handover"
                        className="inline-flex items-center gap-1 text-sm font-medium text-[#1A5CFF] mt-2 hover:underline"
                      >
                        Create your first hand-off{" "}
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
