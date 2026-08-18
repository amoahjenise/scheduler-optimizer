"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import {
  ArrowLeft,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Filter,
  LayoutGrid,
  LayoutList,
  Save,
  UserCircle2,
  Users,
  X,
} from "lucide-react";
import {
  fetchOptimizedScheduleByIdAPI,
  createDraftScheduleAPI,
  fetchScheduleVersionsAPI,
  promoteScheduleVersionAPI,
  listNursesAPI,
  type ScheduleVersion,
  type Nurse,
} from "../../lib/api";
import { useOrganization } from "../../context/OrganizationContext";
import { useScheduleTemplates } from "../../scheduler/hooks/useScheduleTemplates";
import { SaveTemplateDialog } from "../../scheduler/components/ScheduleTemplateManager";
import {
  buildNurseNameByUserId,
  resolveDisplayName,
} from "../../lib/nameDisplay";

type ShiftEntry = {
  date?: string;
  shift?: string;
  shiftType?: "day" | "night";
  hours?: number;
  time?: string;
  startTime?: string;
  endTime?: string;
};

type GridRow = {
  id?: string;
  nurse?: string;
  name?: string;
  shifts?: ShiftEntry[];
};

export default function ScheduleDetailsPage() {
  const params = useParams<{ id: string }>();
  const scheduleId = params?.id;
  const router = useRouter();
  const { user } = useUser();
  const t = useTranslations("schedules");
  const locale = useLocale();
  const {
    canManage,
    getAuthHeaders,
    isLoading: orgLoading,
    currentOrganization,
  } = useOrganization();
  const backHref = canManage ? "/admin/schedules" : "/schedules";
  const backLabel = canManage
    ? t("backToScheduleManagement")
    : t("backToTeamSchedules");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<any>(null);
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false);
  const [templateSavedName, setTemplateSavedName] = useState<string | null>(
    null,
  );
  const savedToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nurse filter state
  const [nurseFilter, setNurseFilter] = useState<string>("all");
  const [showMyScheduleOnly, setShowMyScheduleOnly] = useState(false);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [creatingRevision, setCreatingRevision] = useState(false);
  const [calendarView, setCalendarView] = useState(false);

  // Version family state
  const [versions, setVersions] = useState<ScheduleVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [versionRootId, setVersionRootId] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [showVersionTimeline, setShowVersionTimeline] = useState(false);
  const [nurseNameByUserId, setNurseNameByUserId] = useState<
    Map<string, { name: string; team: string | null }>
  >(new Map());

  // Template functionality
  const scheduleTemplates = useScheduleTemplates(
    currentOrganization?.id ?? null,
  );

  useEffect(() => {
    async function load() {
      if (!scheduleId || orgLoading || !currentOrganization) return;
      try {
        setLoading(true);
        const authHeaders = await getAuthHeaders();
        const data = await fetchOptimizedScheduleByIdAPI(
          scheduleId,
          authHeaders,
        );
        // Block access to non-finalized schedules for non-admins
        if (!data.is_finalized && !canManage) {
          setError(t("scheduleNotFinalized"));
          return;
        }
        setSchedule(data);
      } catch (e) {
        console.error("Failed to load schedule details", e);
        setError(t("failedToLoadScheduleDetails"));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [scheduleId, canManage, orgLoading, currentOrganization, getAuthHeaders]);

  const loadVersions = useCallback(async () => {
    if (!scheduleId || orgLoading || !currentOrganization) return;
    try {
      const authHeaders = await getAuthHeaders();
      const data = await fetchScheduleVersionsAPI(scheduleId, authHeaders);
      setVersions(data.versions);
      setActiveVersionId(data.active_id);
      setVersionRootId(data.root_id || null);

      try {
        const nursesResponse = await listNursesAPI(
          user?.id || "",
          1,
          500,
          undefined,
          authHeaders,
        );
        setNurseNameByUserId(
          buildNurseNameByUserId(nursesResponse.nurses || ([] as Nurse[])),
        );
      } catch (nurseError) {
        console.warn(
          "Failed to load nurse names for version timeline:",
          nurseError,
        );
        setNurseNameByUserId(new Map());
      }
    } catch (e) {
      console.error("Failed to load schedule versions", e);
      setVersions([]);
      setVersionRootId(null);
    }
  }, [scheduleId, orgLoading, currentOrganization, getAuthHeaders, user?.id]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  const handlePromoteVersion = async (versionId: string) => {
    if (
      !confirm(
        "Make this revision the active version? The other revisions in this family will be marked as drafts.",
      )
    ) {
      return;
    }

    setPromotingId(versionId);
    try {
      const authHeaders = await getAuthHeaders();
      await promoteScheduleVersionAPI(versionId, authHeaders);
      await loadVersions();

      // Keep the currently viewed schedule's badge in sync.
      const refreshed = await fetchOptimizedScheduleByIdAPI(
        scheduleId,
        authHeaders,
      );
      setSchedule(refreshed);
    } catch (e) {
      console.error("Failed to promote schedule version", e);
      setError(
        e instanceof Error ? e.message : "Failed to promote schedule version",
      );
    } finally {
      setPromotingId(null);
    }
  };

  const parsed = useMemo(() => {
    if (!schedule) return { dates: [] as string[], rows: [] as GridRow[] };

    try {
      const raw =
        typeof schedule.schedule_data === "string"
          ? JSON.parse(schedule.schedule_data)
          : schedule.schedule_data || {};

      let dates: string[] = Array.isArray(raw?.dates)
        ? (raw.dates as string[])
        : [];
      const rows: GridRow[] = Array.isArray(raw?.schedule)
        ? (raw.schedule as GridRow[])
        : Array.isArray(raw?.grid)
          ? (raw.grid as GridRow[])
          : [];

      if (!dates.length) {
        const dateSet = new Set<string>();
        rows.forEach((row: GridRow) => {
          (row.shifts || []).forEach((shift) => {
            if (shift?.date) dateSet.add(shift.date);
          });
        });
        dates = Array.from(dateSet).sort();
      }

      return { dates, rows };
    } catch (err) {
      console.error("Failed to parse schedule_data", err);
      return { dates: [] as string[], rows: [] as GridRow[] };
    }
  }, [schedule]);

  // Get all nurse names for filter dropdown
  const nurseNames = useMemo(() => {
    return parsed.rows.map((row) => row.nurse || row.name || "Unknown");
  }, [parsed.rows]);

  // Match current user to their nurse row (by name similarity)
  const currentUserNurseName = useMemo(() => {
    if (!user) return null;
    const userName = user.fullName?.toLowerCase() || "";
    const firstName = user.firstName?.toLowerCase() || "";
    const lastName = user.lastName?.toLowerCase() || "";

    for (const row of parsed.rows) {
      const nurseName = (row.nurse || row.name || "").toLowerCase();
      // Check for exact match or partial match
      if (
        nurseName === userName ||
        (firstName &&
          lastName &&
          nurseName.includes(firstName) &&
          nurseName.includes(lastName)) ||
        (firstName && nurseName.includes(firstName)) ||
        (lastName && nurseName.includes(lastName))
      ) {
        return row.nurse || row.name || null;
      }
    }
    return null;
  }, [user, parsed.rows]);

  // Filter rows based on selected filter
  const filteredRows = useMemo(() => {
    if (showMyScheduleOnly && currentUserNurseName) {
      return parsed.rows.filter(
        (row) => (row.nurse || row.name) === currentUserNurseName,
      );
    }
    if (nurseFilter !== "all") {
      return parsed.rows.filter(
        (row) => (row.nurse || row.name) === nurseFilter,
      );
    }
    return parsed.rows;
  }, [parsed.rows, nurseFilter, showMyScheduleOnly, currentUserNurseName]);

  const stats = useMemo(() => {
    const nurses = parsed.rows.length;
    const days = parsed.dates.length;
    const assignments = parsed.rows.reduce(
      (total, row) =>
        total +
        (row.shifts || []).filter((s) => Number(s?.hours || 0) > 0).length,
      0,
    );
    return { nurses, days, assignments };
  }, [parsed]);

  const dateRangeLabel = useMemo(() => {
    const start = schedule?.start_date || parsed.dates[0];
    const end =
      schedule?.end_date || parsed.dates[Math.max(0, parsed.dates.length - 1)];
    return `${formatDate(start)} - ${formatDate(end)}`;
  }, [schedule, parsed]);

  const scheduleTitle =
    typeof schedule?.name === "string" && schedule.name.trim().length > 0
      ? schedule.name
      : dateRangeLabel;
  const showDateSubtitle = scheduleTitle !== dateRangeLabel;

  const getShiftBadgeClasses = (shift?: ShiftEntry) => {
    const shiftCode = (shift?.shift || "").toUpperCase();
    const hours = Number(shift?.hours || 0);
    if (!shiftCode || hours <= 0) {
      return "bg-slate-100 text-slate-400 border border-slate-200";
    }
    if (
      shift?.shiftType === "night" ||
      shiftCode.includes("N") ||
      shiftCode.includes("23")
    ) {
      return "bg-indigo-50 text-indigo-700 border border-indigo-200";
    }
    return "bg-amber-50 text-amber-700 border border-amber-200";
  };

  const getShiftTimeText = (shift?: ShiftEntry) => {
    if (!shift) return "";
    const shiftCode = (shift.shift || "").toUpperCase().trim();
    if (!shiftCode || shiftCode === "—") return "";

    // Calculate correct times based on shift code (override database values)
    // Note: Clock times shown for display, but hours are PAID (minus breaks)
    let code = shiftCode;
    const hasBackShift = code.endsWith(" B");
    if (hasBackShift) {
      code = code.replace(/ B$/, "");
    }

    // 12h Day Shifts (11.25h paid)
    if (code === "Z07" || code.startsWith("ZD12-")) return "07:00 - 19:25";
    if (code === "Z11") return "11:00 - 23:25";

    // Z19: Evening start of 12h night (19:00 - 23:59)
    if (code === "Z19" || code.startsWith("ZE2-")) return "19:00 - 23:59";

    // Z23/Z23 B: Morning portion of 12h night (00:00 - 07:25)
    // This is the MORNING shift, not starting at 23:00
    if (code === "Z23" || code.startsWith("ZN-")) return "00:00 - 07:25";

    // 8h Shifts
    if (code === "07" || code.startsWith("D8-")) return "07:00 - 15:15";
    if (code === "11" || code.startsWith("I1")) return "11:00 - 19:15";
    if (code === "E15" || code.startsWith("E8-")) return "15:00 - 23:15";
    if (code === "23" || code.startsWith("N8-")) return "23:00 - 07:15";

    // Fallback to database values if shift code not recognized
    if (shift.time?.includes("-") || shift.time?.includes("–"))
      return shift.time;
    if (shift.startTime && shift.endTime)
      return `${shift.startTime} - ${shift.endTime}`;
    if (shift.startTime) return shift.startTime;
    return "";
  };

  function formatDate(dateStr?: string) {
    if (!dateStr) return "N/A";
    // Normalize date-only strings (YYYY-MM-DD) to local midnight to avoid
    // UTC-to-local conversion shifting the date back by one day.
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
      ? `${dateStr}T00:00:00`
      : dateStr;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return "N/A";
    return parsed.toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  const handleSaveTemplate = (name: string, notes?: string) => {
    if (!schedule || !parsed.rows.length) return;

    const startDate = schedule.start_date || parsed.dates[0];
    const endDate =
      schedule.end_date || parsed.dates[Math.max(0, parsed.dates.length - 1)];

    if (!startDate || !endDate) return;

    try {
      const result = scheduleTemplates.saveTemplate(
        name,
        parsed.rows as import("../../scheduler/types").GridRow[],
        startDate,
        endDate,
        undefined,
        notes,
      );
      if (result) {
        setShowSaveTemplateDialog(false);
        setTemplateSavedName(name);
        if (savedToastTimer.current) clearTimeout(savedToastTimer.current);
        savedToastTimer.current = setTimeout(
          () => setTemplateSavedName(null),
          3000,
        );
      }
    } catch (error) {
      console.error("Failed to save template:", error);
    }
  };

  // Create a new revision (draft) from existing finalized schedule
  const handleCreateRevision = async () => {
    if (!schedule || !schedule.is_finalized) return;

    setCreatingRevision(true);
    try {
      const authHeaders = await getAuthHeaders();
      const scheduleData =
        typeof schedule.schedule_data === "string"
          ? JSON.parse(schedule.schedule_data)
          : schedule.schedule_data || {};

      // Create a draft with the same data but marked as revision
      const draftPayload = {
        name: schedule.name
          ? `${schedule.name} (Revision)`
          : `Schedule Revision - ${formatDate(schedule.start_date)}`,
        start_date: schedule.start_date || parsed.dates[0],
        end_date:
          schedule.end_date ||
          parsed.dates[Math.max(0, parsed.dates.length - 1)],
        schedule_data: {
          ...scheduleData,
          revision_of: schedule.id,
          revision_date: new Date().toISOString(),
        },
      };

      const newDraft = await createDraftScheduleAPI(draftPayload, authHeaders);
      // Navigate to the scheduler to edit the new draft
      router.push(`/scheduler?scheduleId=${newDraft.id}`);
    } catch (error) {
      console.error("Failed to create revision:", error);
      setError(t("failedToCreateRevision") || "Failed to create revision");
    } finally {
      setCreatingRevision(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600" />
      </div>
    );
  }

  if (error || !schedule) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Link
          href={backHref}
          className="text-emerald-600 hover:underline inline-flex items-center gap-1 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          {backLabel}
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">
          {error || t("scheduleNotFound")}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50/30">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-5">
        <Link
          href={backHref}
          className="text-sm text-emerald-600 hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" />
          {backLabel}
        </Link>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {scheduleTitle}
              </h1>
              {showDateSubtitle && (
                <p className="text-sm text-slate-600 mt-1 inline-flex items-center gap-1.5">
                  <CalendarDays className="w-4 h-4" />
                  {dateRangeLabel}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {schedule?.is_finalized && canManage && (
                <>
                  <button
                    onClick={handleCreateRevision}
                    disabled={creatingRevision}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 transition-colors disabled:opacity-50"
                    title={t("createRevision")}
                  >
                    <Copy className="w-4 h-4" />
                    {creatingRevision ? t("creating") : t("createRevision")}
                  </button>
                  <button
                    onClick={() => setShowSaveTemplateDialog(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 transition-colors"
                    title={t("saveAsTemplate")}
                  >
                    <Save className="w-4 h-4" />
                    {t("saveAsTemplate")}
                  </button>
                </>
              )}
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border bg-emerald-50 text-emerald-700 border-emerald-200">
                <CheckCircle2 className="w-4 h-4" />
                {schedule?.is_finalized ? t("finalized") : t("draft")}
              </div>
              {activeVersionId === scheduleId && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border bg-blue-50 text-blue-700 border-blue-200">
                  Active version
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-2 text-xs text-slate-600 flex flex-wrap items-center gap-4">
            <span>
              Revision ID: <span className="font-mono text-slate-800">{schedule.id}</span>
            </span>
            <span>
              Family Root: <span className="font-mono text-slate-800">{versionRootId || schedule.id}</span>
            </span>
          </div>

          {versions.length > 1 && (
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-slate-500">
                    Version
                  </label>
                  <select
                    value={scheduleId}
                    onChange={(e) => {
                      if (e.target.value !== scheduleId) {
                        router.push(`/schedules/${e.target.value}`);
                      }
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                  >
                    {versions.map((version, index) => (
                      <option key={version.id} value={version.id}>
                        v{index + 1}
                        {` [${version.id.slice(0, 8)}]`}
                        {version.id === activeVersionId ? " (active)" : ""}
                        {version.created_at
                          ? ` · ${new Date(version.created_at).toLocaleDateString()}`
                          : ""}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-slate-500">
                    {versions.length} revisions
                  </span>
                </div>

                <button
                  onClick={() => setShowVersionTimeline((prev) => !prev)}
                  className="text-sm font-medium text-emerald-700 hover:underline"
                >
                  {showVersionTimeline ? "Hide timeline" : "Show timeline"}
                </button>
              </div>

              {showVersionTimeline && (
                <ol className="mt-4 space-y-3 border-l border-slate-200 pl-4">
                  {versions.map((version, index) => {
                    const isActive = version.id === activeVersionId;
                    const isCurrent = version.id === scheduleId;

                    return (
                      <li key={version.id} className="relative">
                        <span
                          className={`absolute -left-[21px] top-1.5 h-3 w-3 rounded-full border-2 border-white ${
                            isActive ? "bg-emerald-500" : "bg-slate-300"
                          }`}
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-slate-900">
                              v{index + 1}
                              {isActive && (
                                <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                  Active
                                </span>
                              )}
                              {isCurrent && !isActive && (
                                <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                                  Viewing
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-slate-500">
                              {(() => {
                                const creator =
                                  resolveDisplayName({
                                    nurseName: version.created_by
                                      ? nurseNameByUserId.get(
                                          version.created_by,
                                        )?.name
                                      : null,
                                    accountName: version.created_by_name,
                                    allowUserIdFallback: false,
                                  }) || "";
                                return creator ? `${creator} · ` : "";
                              })()}
                              {version.created_at
                                ? new Date(version.created_at).toLocaleString()
                                : "Unknown date"}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            {!isCurrent && (
                              <Link
                                href={`/schedules/${version.id}`}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                View
                              </Link>
                            )}
                            {canManage && !isActive && (
                              <button
                                onClick={() => handlePromoteVersion(version.id)}
                                disabled={promotingId === version.id}
                                className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                {promotingId === version.id
                                  ? "Promoting..."
                                  : "Make active"}
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-xs text-slate-500">{t("nurses")}</p>
              <p className="text-lg font-semibold text-slate-900 inline-flex items-center gap-1.5">
                <Users className="w-4 h-4 text-slate-500" />
                {stats.nurses}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-xs text-slate-500">{t("days")}</p>
              <p className="text-lg font-semibold text-slate-900 inline-flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-slate-500" />
                {stats.days}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-xs text-slate-500">{t("assignedShifts")}</p>
              <p className="text-lg font-semibold text-slate-900 inline-flex items-center gap-1.5">
                <Clock3 className="w-4 h-4 text-slate-500" />
                {stats.assignments}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            {/* Legend */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="px-2 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                {t("dayShift")}
              </span>
              <span className="px-2 py-1 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700">
                {t("nightShift")}
              </span>
              <span className="px-2 py-1 rounded-full border border-slate-200 bg-slate-100 text-slate-500">
                {t("off")}
              </span>
            </div>

            {/* Filter controls */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Calendar view toggle (only for single nurse view) */}
              {filteredRows.length === 1 && (
                <button
                  onClick={() => setCalendarView(!calendarView)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    calendarView
                      ? "bg-purple-100 text-purple-700 border-purple-300"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {calendarView ? (
                    <>
                      <LayoutGrid className="w-3.5 h-3.5" />
                      {t("calendarView")}
                    </>
                  ) : (
                    <>
                      <LayoutList className="w-3.5 h-3.5" />
                      {t("tableView")}
                    </>
                  )}
                </button>
              )}

              {/* My Schedule Only toggle (for non-admins with matched nurse) */}
              {!canManage && currentUserNurseName && (
                <button
                  onClick={() => {
                    setShowMyScheduleOnly(!showMyScheduleOnly);
                    if (!showMyScheduleOnly) setNurseFilter("all");
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    showMyScheduleOnly
                      ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <UserCircle2 className="w-3.5 h-3.5" />
                  {t("myScheduleOnly")}
                </button>
              )}

              {/* Nurse filter dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    nurseFilter !== "all"
                      ? "bg-blue-100 text-blue-700 border-blue-300"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  {nurseFilter === "all" ? t("filterByNurse") : nurseFilter}
                  {nurseFilter !== "all" ? (
                    <X
                      className="w-3.5 h-3.5 ml-0.5 hover:text-blue-900"
                      onClick={(e) => {
                        e.stopPropagation();
                        setNurseFilter("all");
                        setShowFilterDropdown(false);
                      }}
                    />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>

                {showFilterDropdown && (
                  <div className="absolute right-0 mt-1 z-40 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[180px] max-h-[240px] overflow-auto">
                    <button
                      onClick={() => {
                        setNurseFilter("all");
                        setShowFilterDropdown(false);
                        setShowMyScheduleOnly(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 ${
                        nurseFilter === "all"
                          ? "font-semibold text-emerald-600"
                          : "text-slate-700"
                      }`}
                    >
                      {t("allNurses")}
                    </button>
                    {nurseNames.map((name) => (
                      <button
                        key={name}
                        onClick={() => {
                          setNurseFilter(name);
                          setShowFilterDropdown(false);
                          setShowMyScheduleOnly(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 ${
                          nurseFilter === name
                            ? "font-semibold text-emerald-600"
                            : "text-slate-700"
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {filteredRows.length > 0 ? (
            <>
              {/* Calendar View (single nurse only) - Google Calendar style */}
              {calendarView && filteredRows.length === 1 ? (
                <div className="overflow-auto border border-slate-200 rounded-xl bg-slate-50 shadow-sm">
                  <div className="min-w-[800px]">
                    {/* Header row with dates */}
                    <div
                      className="grid border-b-2 border-slate-300 sticky top-0 bg-white z-10 shadow-sm"
                      style={{
                        gridTemplateColumns: `80px repeat(${parsed.dates.length}, minmax(140px, 1fr))`,
                      }}
                    >
                      <div className="border-r border-slate-300 bg-slate-50"></div>
                      {parsed.dates.map((date) => {
                        const dateObj = new Date(
                          /^\d{4}-\d{2}-\d{2}$/.test(date)
                            ? `${date}T00:00:00`
                            : date,
                        );
                        const isToday =
                          dateObj.toDateString() === new Date().toDateString();

                        return (
                          <div
                            key={date}
                            className={`text-center py-4 border-r border-slate-300 ${
                              isToday
                                ? "bg-gradient-to-b from-emerald-100 to-emerald-50"
                                : "bg-white"
                            }`}
                          >
                            <div
                              className={`text-xs font-semibold uppercase tracking-wide ${
                                isToday ? "text-emerald-700" : "text-slate-500"
                              }`}
                            >
                              {dateObj.toLocaleDateString(locale, {
                                weekday: "short",
                              })}
                            </div>
                            <div
                              className={`text-xl font-bold mt-1 ${
                                isToday ? "text-emerald-900" : "text-slate-900"
                              }`}
                            >
                              {dateObj.getDate()}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Time grid */}
                    <div className="relative bg-white">
                      {/* Generate 24-hour time slots */}
                      {Array.from({ length: 24 }, (_, hour) => {
                        const row = filteredRows[0];

                        // Collect ALL shifts per date (may have multiple entries needing merge)
                        const allShiftsByDate = new Map<string, ShiftEntry[]>();
                        (row.shifts || []).forEach((shift) => {
                          if (shift?.date) {
                            const existing =
                              allShiftsByDate.get(shift.date) || [];
                            existing.push(shift);
                            allShiftsByDate.set(shift.date, existing);
                          }
                        });

                        // Keep shifts separate - do NOT merge Z19 + Z23 into combined code
                        const shiftsByDate = new Map<string, ShiftEntry>();
                        allShiftsByDate.forEach((shifts, date) => {
                          if (shifts.length === 1) {
                            shiftsByDate.set(date, shifts[0]);
                          } else {
                            // Multiple shifts on same day - pick the primary one
                            // Priority: Z23/Z23 B (night end) > Z19 (evening start) > others
                            const sorted = [...shifts].sort((a, b) => {
                              const codeA = (a.shift || "").toUpperCase();
                              const codeB = (b.shift || "").toUpperCase();
                              // Z23 variants first
                              if (
                                codeA.startsWith("Z23") &&
                                !codeB.startsWith("Z23")
                              )
                                return -1;
                              if (
                                !codeA.startsWith("Z23") &&
                                codeB.startsWith("Z23")
                              )
                                return 1;
                              // Z19 second
                              if (codeA === "Z19" && codeB !== "Z19") return -1;
                              if (codeA !== "Z19" && codeB === "Z19") return 1;
                              return 0;
                            });
                            shiftsByDate.set(date, sorted[0]);
                          }
                        });

                        return (
                          <div
                            key={hour}
                            className="grid border-b border-slate-200"
                            style={{
                              gridTemplateColumns: `80px repeat(${parsed.dates.length}, minmax(140px, 1fr))`,
                              minHeight: "60px",
                            }}
                          >
                            {/* Time label */}
                            <div className="border-r border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 text-right bg-slate-50">
                              {hour === 0
                                ? "12 AM"
                                : hour < 12
                                  ? `${hour} AM`
                                  : hour === 12
                                    ? "12 PM"
                                    : `${hour - 12} PM`}
                            </div>

                            {/* Day columns */}
                            {parsed.dates.map((date, dateIndex) => {
                              const shift = shiftsByDate.get(date);
                              // Check if previous day has a shift that crosses midnight
                              const prevDate =
                                dateIndex > 0
                                  ? parsed.dates[dateIndex - 1]
                                  : null;
                              const prevShift = prevDate
                                ? shiftsByDate.get(prevDate)
                                : null;

                              const dateObj = new Date(
                                /^\d{4}-\d{2}-\d{2}$/.test(date)
                                  ? `${date}T00:00:00`
                                  : date,
                              );
                              const isToday =
                                dateObj.toDateString() ===
                                new Date().toDateString();

                              // Shift time mapping based on shift codes
                              // Night shifts are represented as separate codes:
                              // - Z19 = Evening start (19:00-23:59) - shown on start day
                              // - Z23 B = Morning end + coming back (00:00-07:25) - shown on next day
                              // - Z23 = Morning end only (00:00-07:25) - shown on final day
                              const getShiftTimes = (shiftCode: string) => {
                                let code = shiftCode.toUpperCase().trim();

                                // Check for " B" suffix (Back/Split shift)
                                const hasBackShift = code.endsWith(" B");
                                if (hasBackShift) {
                                  code = code.replace(/ B$/, "");
                                }

                                let primaryShift = null;

                                // 8h Shifts (7.5h actual + 0.5h handover)
                                if (code === "07" || code.startsWith("D8-"))
                                  primaryShift = {
                                    start: "07:00",
                                    end: "15:15",
                                    crossesMidnight: false,
                                  };
                                else if (code === "11" || code.startsWith("I1"))
                                  primaryShift = {
                                    start: "11:00",
                                    end: "19:15",
                                    crossesMidnight: false,
                                  };
                                else if (
                                  code === "E15" ||
                                  code.startsWith("E8-")
                                )
                                  primaryShift = {
                                    start: "15:00",
                                    end: "23:15",
                                    crossesMidnight: false,
                                  };
                                else if (
                                  code === "23" ||
                                  code.startsWith("N8-")
                                )
                                  primaryShift = {
                                    start: "23:00",
                                    end: "07:15",
                                    crossesMidnight: true,
                                  };
                                // 12h Day Shifts
                                else if (
                                  code === "Z07" ||
                                  code.startsWith("ZD12-")
                                )
                                  primaryShift = {
                                    start: "07:00",
                                    end: "19:25",
                                    crossesMidnight: false,
                                  };
                                else if (code === "Z11")
                                  primaryShift = {
                                    start: "11:00",
                                    end: "23:25",
                                    crossesMidnight: false,
                                  };
                                // Z19: Evening start of split night (19:00-23:00), 3h45m paid
                                else if (
                                  code === "Z19" ||
                                  code.startsWith("ZE2-")
                                )
                                  primaryShift = {
                                    start: "19:00",
                                    end: "23:00",
                                    crossesMidnight: false,
                                  };
                                // Z23: Night portion (23:00-07:25), 7h30m paid, crosses midnight
                                // Z23 B: Back shift - nurse works Z23 morning PLUS returns for Z19+Z23 evening
                                else if (
                                  code === "Z23" ||
                                  code.startsWith("ZN-")
                                )
                                  primaryShift = {
                                    start: "23:00",
                                    end: "07:25",
                                    crossesMidnight: true,
                                  };

                                // Return the primary shift
                                // Note: The "B" suffix indicates the nurse is coming back for
                                // another shift on the NEXT day - it doesn't create a separate
                                // shift on the same day, so we just strip it and display normally
                                return primaryShift
                                  ? { primary: primaryShift, back: null }
                                  : null;
                              };

                              // Calculate correct PAID hours based on shift code (override database values)
                              // PAID HOURS = clock time minus unpaid breaks:
                              // - 12h shifts: 11.25h paid (12h - 0.75h break)
                              // - 8h shifts: 7.5h paid (8h - 0.5h break)
                              // Night shift split: Z19 (4h) + Z23 (7.25h) = 11.25h total
                              const getShiftHours = (shiftCode: string) => {
                                let code = shiftCode.toUpperCase().trim();
                                const hasBackShift = code.endsWith(" B");
                                if (hasBackShift) {
                                  code = code.replace(/ B$/, "");
                                }

                                // 12h day shifts = 11.25h paid
                                if (code === "Z07" || code.startsWith("ZD12-"))
                                  return 11.25;
                                if (code === "Z11") return 11.25;

                                // Z19 = 4h (evening portion of split night)
                                if (code === "Z19" || code.startsWith("ZE2-"))
                                  return 4.0;

                                // Z23 = 7.25h paid (morning portion of split night)
                                if (code === "Z23" || code.startsWith("ZN-"))
                                  return 7.25;

                                // 8h shifts = 7.5h paid
                                if (code === "07" || code.startsWith("D8-"))
                                  return 7.5;
                                if (code === "11" || code.startsWith("I1"))
                                  return 7.5;
                                if (code === "E15" || code.startsWith("E8-"))
                                  return 7.5;
                                if (code === "23" || code.startsWith("N8-"))
                                  return 7.5;

                                // Fallback: return 0 for unknown shifts
                                return 0;
                              };

                              // Parse shift times - handle multiple formats
                              const parseTime = (timeStr?: string) => {
                                if (!timeStr) return null;
                                const match =
                                  timeStr.match(/(\d{1,2}):(\d{2})/);
                                if (match) {
                                  return {
                                    hour: parseInt(match[1]),
                                    minute: parseInt(match[2]),
                                  };
                                }
                                return null;
                              };

                              // Helper to extract times from a shift
                              const extractShiftTimes = (
                                s: ShiftEntry | null | undefined,
                              ) => {
                                if (!s) return null;

                                let start = null;
                                let end = null;
                                let displayStart = "";
                                let displayEnd = "";
                                let crossesMidnight = false;

                                // First, try to get predefined times from shift code
                                const shiftCode = s.shift || "";
                                const predefinedTimes =
                                  getShiftTimes(shiftCode);

                                if (predefinedTimes?.primary) {
                                  start = parseTime(
                                    predefinedTimes.primary.start,
                                  );
                                  end = parseTime(predefinedTimes.primary.end);
                                  displayStart = predefinedTimes.primary.start;
                                  displayEnd = predefinedTimes.primary.end;
                                  crossesMidnight =
                                    predefinedTimes.primary.crossesMidnight;
                                }
                                // Fallback: Check if time is in the "time" field (e.g., "07:00 - 19:25")
                                else if (
                                  s.time &&
                                  (s.time.includes("-") || s.time.includes("–"))
                                ) {
                                  const timeParts = s.time.split(/\s*[-–]\s*/);
                                  if (timeParts.length === 2) {
                                    start = parseTime(timeParts[0].trim());
                                    end = parseTime(timeParts[1].trim());
                                    displayStart = timeParts[0].trim();
                                    displayEnd = timeParts[1].trim();
                                    // Detect midnight crossing
                                    if (
                                      start &&
                                      end &&
                                      (end.hour < start.hour ||
                                        (end.hour === start.hour &&
                                          end.minute < start.minute))
                                    ) {
                                      crossesMidnight = true;
                                    }
                                  }
                                }
                                // Otherwise check startTime and endTime fields
                                else if (s.startTime || s.endTime) {
                                  start = parseTime(s.startTime);
                                  end = parseTime(s.endTime);
                                  displayStart = s.startTime || "";
                                  displayEnd = s.endTime || "";
                                  // Detect midnight crossing
                                  if (
                                    start &&
                                    end &&
                                    (end.hour < start.hour ||
                                      (end.hour === start.hour &&
                                        end.minute < start.minute))
                                  ) {
                                    crossesMidnight = true;
                                  }
                                }

                                return {
                                  start,
                                  end,
                                  displayStart,
                                  displayEnd,
                                  crossesMidnight,
                                };
                              };

                              const shiftTimes = extractShiftTimes(shift);
                              const prevShiftTimes =
                                extractShiftTimes(prevShift);

                              const shiftCode = shift?.shift || "";
                              const currentShiftCodeUpper = shiftCode
                                .toUpperCase()
                                .trim();

                              const prevShiftCodeUpper = (
                                prevShift?.shift || ""
                              )
                                .toUpperCase()
                                .trim();

                              // Detect Z23 / Z23 B (morning portion of a split night shift)
                              const isCurrentZ23 =
                                currentShiftCodeUpper === "Z23" ||
                                currentShiftCodeUpper === "Z23 B" ||
                                currentShiftCodeUpper.startsWith("ZN-");

                              const prevShiftCrossesMidnight =
                                prevShiftTimes?.crossesMidnight || false;

                              // Check if previous day had Z19 (evening start)
                              const prevWasZ19 =
                                prevShiftCodeUpper === "Z19" ||
                                prevShiftCodeUpper.startsWith("ZE2-");

                              // Z23 morning block should NOT render independently when it's
                              // the completion of a previous night shift (Z19 or Z23 B)
                              const isZ23Continuation =
                                isCurrentZ23 &&
                                (prevWasZ19 || prevShiftCrossesMidnight);

                              // Check if current shift is Z19 (evening start of split night)
                              const isZ19 =
                                currentShiftCodeUpper === "Z19" ||
                                currentShiftCodeUpper.startsWith("ZE2-");

                              // Look ahead: does the next day have Z23 / Z23 B?
                              // If so, show 23:00-00:00 connection block on Z19 day
                              const nextDate =
                                dateIndex < parsed.dates.length - 1
                                  ? parsed.dates[dateIndex + 1]
                                  : null;
                              const nextShift = nextDate
                                ? shiftsByDate.get(nextDate)
                                : null;
                              const nextCodeUpper = (nextShift?.shift || "")
                                .toUpperCase()
                                .trim();
                              const nextIsZ23 =
                                nextCodeUpper === "Z23" ||
                                nextCodeUpper === "Z23 B" ||
                                nextCodeUpper.startsWith("ZN-");

                              // Show Z19 -> Z23 connection block at 23:00
                              const shouldShowZ19ToZ23Connection =
                                isZ19 && nextIsZ23 && hour === 23;

                              // Use calculated hours based on shift code (not database value)
                              const hours = shiftCode
                                ? getShiftHours(shiftCode)
                                : Number(shift?.hours || 0);

                              // Use the crossesMidnight flag from extracted times
                              const shiftCrossesMidnight =
                                shiftTimes?.crossesMidnight || false;

                              // Don't render Z23 morning block independently when it's a continuation
                              const shouldShowShift =
                                !isZ23Continuation &&
                                shiftTimes?.start &&
                                shiftTimes.start.hour === hour &&
                                hours > 0;

                              // Overnight continuation: show after-midnight portion of previous night shift
                              // This handles Z23 (23:00→07:25) and regular N8 (23:00→07:15)
                              const shouldShowOvernightContinuation =
                                prevShiftCrossesMidnight &&
                                prevShiftTimes?.end &&
                                hour === 0;

                              // Z23 B = Back shift: Z23 morning (23:00→07:25) PLUS back at 19:00 for another night
                              const hasBackShift =
                                currentShiftCodeUpper.endsWith(" B");

                              // Show evening portion of back shift (19:00-23:00)
                              const shouldShowBackShiftEvening =
                                isCurrentZ23 && hasBackShift && hour === 19;

                              // Show night start portion of back shift (23:00-00:00)
                              const shouldShowBackShiftNightStart =
                                isCurrentZ23 && hasBackShift && hour === 23;

                              // Calculate block heights
                              let blockHeight = 0;
                              let topOffset = 0;

                              if (shouldShowShift && shiftTimes?.start) {
                                if (shiftCrossesMidnight) {
                                  // Show from start time to midnight
                                  const hoursUntilMidnight =
                                    24 -
                                    shiftTimes.start.hour -
                                    shiftTimes.start.minute / 60;
                                  blockHeight = hoursUntilMidnight * 60;
                                } else {
                                  // Normal shift within one day - calculate from actual start/end times
                                  if (shiftTimes.end) {
                                    const startInHours =
                                      shiftTimes.start.hour +
                                      shiftTimes.start.minute / 60;
                                    const endInHours =
                                      shiftTimes.end.hour +
                                      shiftTimes.end.minute / 60;
                                    const duration = endInHours - startInHours;
                                    blockHeight = duration * 60;
                                  } else {
                                    // Fallback to hours field if no end time
                                    blockHeight = hours * 60;
                                  }
                                }
                                topOffset = (shiftTimes.start.minute / 60) * 60;
                              } else if (
                                shouldShowOvernightContinuation &&
                                prevShiftTimes?.end
                              ) {
                                // Continuation from midnight to end time
                                const hoursFromMidnight =
                                  prevShiftTimes.end.hour +
                                  prevShiftTimes.end.minute / 60;
                                blockHeight = hoursFromMidnight * 60;
                                topOffset = 0;
                              }

                              // Z19 / ZE2- are night shifts but don't contain "N" or "23"
                              const isNightShift =
                                shift?.shiftType === "night" ||
                                currentShiftCodeUpper.includes("N") ||
                                currentShiftCodeUpper.includes("23") ||
                                currentShiftCodeUpper === "Z19" ||
                                currentShiftCodeUpper.startsWith("ZE2-");

                              const prevIsNightShift =
                                prevShift?.shiftType === "night" ||
                                prevShiftCodeUpper.includes("N") ||
                                prevShiftCodeUpper.includes("23") ||
                                prevShiftCodeUpper === "Z19" ||
                                prevShiftCodeUpper.startsWith("ZE2-");

                              return (
                                <div
                                  key={date}
                                  className={`border-r border-slate-300 relative ${
                                    isToday
                                      ? "bg-gradient-to-b from-emerald-50/50 to-transparent"
                                      : "bg-white"
                                  }`}
                                >
                                  {/* Current day shift */}
                                  {shouldShowShift && shiftTimes?.start && (
                                    <div
                                      className={`absolute rounded-lg shadow-md overflow-hidden cursor-pointer hover:shadow-lg transition-all hover:scale-[1.02] z-10 ${
                                        isNightShift
                                          ? "bg-gradient-to-br from-indigo-500 to-indigo-600 text-white border-2 border-indigo-700"
                                          : "bg-gradient-to-br from-amber-400 to-amber-500 text-white border-2 border-amber-600"
                                      }`}
                                      style={{
                                        height: `${Math.min(blockHeight, 1200)}px`,
                                        top: `${topOffset}px`,
                                        left: "6px",
                                        right: "6px",
                                      }}
                                      title={`${shiftCode}${
                                        shiftTimes.displayStart &&
                                        shiftTimes.displayEnd
                                          ? ` – ${shiftTimes.displayStart} to ${shiftTimes.displayEnd}`
                                          : ""
                                      }`}
                                    >
                                      <div className="p-2.5 text-xs font-bold">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-base">
                                            {isNightShift ? "🌙" : "☀️"}
                                          </span>
                                          <span className="text-sm">
                                            {shiftCode}
                                          </span>
                                        </div>
                                        {shiftTimes.displayStart &&
                                          shiftTimes.displayEnd && (
                                            <div className="text-[10px] font-medium mt-1.5 bg-black/10 rounded px-1.5 py-0.5 inline-block">
                                              {shiftTimes.displayStart} –{" "}
                                              {shiftTimes.displayEnd}
                                            </div>
                                          )}
                                        {hours > 0 && (
                                          <div className="text-[10px] font-semibold mt-1">
                                            {hours}h
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {/* Overnight continuation from previous day */}
                                  {shouldShowOvernightContinuation &&
                                    prevShift &&
                                    prevShiftTimes && (
                                      <div
                                        className={`absolute rounded-lg shadow-md overflow-hidden cursor-pointer hover:shadow-lg transition-all hover:scale-[1.02] z-10 ${
                                          prevIsNightShift
                                            ? "bg-gradient-to-br from-indigo-500 to-indigo-600 text-white border-2 border-indigo-700"
                                            : "bg-gradient-to-br from-amber-400 to-amber-500 text-white border-2 border-amber-600"
                                        }`}
                                        style={{
                                          height: `${Math.min(blockHeight, 1200)}px`,
                                          top: `${topOffset}px`,
                                          left: "6px",
                                          right: "6px",
                                        }}
                                        title={`${prevShift?.shift || shift?.shift || ""} – Night completion 00:00 to ${prevShiftTimes.displayEnd ?? "07:25"}`}
                                      >
                                        <div className="p-2.5 text-xs font-bold">
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-base">
                                              {prevIsNightShift ? "🌙" : "☀️"}
                                            </span>
                                            <span className="text-sm">
                                              {shift?.shift ||
                                                prevShift?.shift ||
                                                "Z23"}
                                            </span>
                                          </div>
                                          {prevShiftTimes.displayEnd && (
                                            <div className="text-[10px] font-medium mt-1.5 bg-black/10 rounded px-1.5 py-0.5 inline-block">
                                              00:00 –{" "}
                                              {prevShiftTimes.displayEnd}
                                            </div>
                                          )}
                                          {hasBackShift && (
                                            <div className="text-[9px] mt-1 bg-amber-500/90 rounded px-1.5 py-0.5 inline-block font-bold tracking-wide animate-pulse">
                                              ↩ BACK 19:00 Tonight
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}

                                  {/* Z23 B evening portion: 19:00-23:00 (Z19 equivalent) */}
                                  {shouldShowBackShiftEvening && (
                                    <div
                                      className="absolute rounded-lg shadow-md overflow-hidden cursor-pointer hover:shadow-lg transition-all hover:scale-[1.02] z-10 bg-gradient-to-br from-indigo-500 to-indigo-600 text-white border-2 border-indigo-700"
                                      style={{
                                        height: `${4 * 60}px`,
                                        top: "0px",
                                        left: "6px",
                                        right: "6px",
                                      }}
                                      title={`${shiftCode} – Back shift evening 19:00-23:00 (3h45m)`}
                                    >
                                      <div className="p-2.5 text-xs font-bold">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-base">🌙</span>
                                          <span className="text-sm">
                                            {shiftCode}
                                          </span>
                                        </div>
                                        <div className="text-[10px] font-medium mt-1.5 bg-black/10 rounded px-1.5 py-0.5 inline-block">
                                          19:00 – 23:00
                                        </div>
                                        <div className="text-[9px] opacity-80 mt-1">
                                          3h45m
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {/* Z19 -> Z23 connection: 23:00-00:00 block on Z19 day */}
                                  {shouldShowZ19ToZ23Connection && (
                                    <div
                                      className="absolute rounded-lg shadow-md overflow-hidden cursor-pointer hover:shadow-lg transition-all hover:scale-[1.02] z-10 bg-gradient-to-br from-indigo-500 to-indigo-600 text-white border-2 border-indigo-700"
                                      style={{
                                        height: `${1 * 60}px`,
                                        top: "0px",
                                        left: "6px",
                                        right: "6px",
                                      }}
                                      title={`${shiftCode} → Z23 – Night continues 23:00-00:00`}
                                    >
                                      <div className="p-2.5 text-xs font-bold">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-base">🌙</span>
                                          <span className="text-sm">
                                            {shiftCode}
                                          </span>
                                        </div>
                                        <div className="text-[9px] opacity-80 mt-0.5">
                                          → 07:25
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {/* Z23 B night start: 23:00-00:00 (first hour of night portion) */}
                                  {shouldShowBackShiftNightStart && (
                                    <div
                                      className="absolute rounded-lg shadow-md overflow-hidden cursor-pointer hover:shadow-lg transition-all hover:scale-[1.02] z-10 bg-gradient-to-br from-indigo-500 to-indigo-600 text-white border-2 border-indigo-700"
                                      style={{
                                        height: `${1 * 60}px`,
                                        top: "0px",
                                        left: "6px",
                                        right: "6px",
                                      }}
                                      title={`${shiftCode} – Back shift night 23:00-00:00`}
                                    >
                                      <div className="p-2.5 text-xs font-bold">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-base">🌙</span>
                                          <span className="text-sm">
                                            {shiftCode}
                                          </span>
                                        </div>
                                        <div className="text-[9px] opacity-80 mt-0.5">
                                          → 07:25
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                /* Table View */
                <div className="overflow-auto max-h-[70vh] relative">
                  <table className="w-full border-separate border-spacing-0 text-xs">
                    <thead>
                      <tr>
                        <th className="sticky top-0 left-0 z-30 bg-white text-left px-3 py-2 border-b border-slate-200 min-w-[170px]">
                          <div className="text-[10px] text-slate-500 leading-none mb-1 truncate max-w-[220px]">
                            {showDateSubtitle ? dateRangeLabel : scheduleTitle}
                          </div>
                          <div className="font-semibold text-slate-700 leading-none">
                            {t("nurse")}
                          </div>
                        </th>
                        {parsed.dates.map((date) => (
                          <th
                            key={date}
                            className="sticky top-0 z-20 bg-white px-1.5 py-2 text-center border-b border-slate-200 min-w-[84px]"
                          >
                            <div className="text-[10px] text-slate-500 leading-none mb-0.5">
                              {new Date(
                                /^\d{4}-\d{2}-\d{2}$/.test(date)
                                  ? `${date}T00:00:00`
                                  : date,
                              ).toLocaleDateString(locale, {
                                weekday: "short",
                              })}
                            </div>
                            <div className="font-semibold text-slate-700 leading-none">
                              {new Date(
                                /^\d{4}-\d{2}-\d{2}$/.test(date)
                                  ? `${date}T00:00:00`
                                  : date,
                              ).toLocaleDateString(locale, {
                                month: "short",
                                day: "numeric",
                              })}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row, idx) => {
                        // Create a map of date -> shift for this nurse
                        // Keep shifts separate - do NOT merge Z19 + Z23 into combined code
                        const allShiftsByDate = new Map<string, ShiftEntry[]>();
                        (row.shifts || []).forEach((shift) => {
                          if (shift?.date) {
                            const existing =
                              allShiftsByDate.get(shift.date) || [];
                            existing.push(shift);
                            allShiftsByDate.set(shift.date, existing);
                          }
                        });

                        const shiftsByDate = new Map<string, ShiftEntry>();
                        allShiftsByDate.forEach((shifts, date) => {
                          if (shifts.length === 1) {
                            shiftsByDate.set(date, shifts[0]);
                          } else {
                            // Multiple shifts on same day - pick the primary one
                            // Priority: Z23/Z23 B (night end) > Z19 (evening start) > others
                            const sorted = [...shifts].sort((a, b) => {
                              const codeA = (a.shift || "").toUpperCase();
                              const codeB = (b.shift || "").toUpperCase();
                              // Z23 variants first
                              if (
                                codeA.startsWith("Z23") &&
                                !codeB.startsWith("Z23")
                              )
                                return -1;
                              if (
                                !codeA.startsWith("Z23") &&
                                codeB.startsWith("Z23")
                              )
                                return 1;
                              // Z19 second
                              if (codeA === "Z19" && codeB !== "Z19") return -1;
                              if (codeA !== "Z19" && codeB === "Z19") return 1;
                              return 0;
                            });
                            shiftsByDate.set(date, sorted[0]);
                          }
                        });

                        return (
                          <tr key={row.id || idx}>
                            <td className="sticky left-0 z-10 bg-white px-3 py-2 border-b border-slate-100 font-medium text-slate-800 text-xs">
                              {row.nurse || row.name || "Unknown"}
                            </td>
                            {parsed.dates.map((date) => {
                              const shift = shiftsByDate.get(date);
                              const shiftCode = shift?.shift || "—";
                              const timeLabel = getShiftTimeText(shift);
                              return (
                                <td
                                  key={date}
                                  className="h-[48px] px-1 py-1 border-b border-slate-100 align-middle"
                                >
                                  <div
                                    title={timeLabel || undefined}
                                    className={`min-h-[36px] rounded-md text-center px-1.5 py-1.5 leading-tight ${getShiftBadgeClasses(shift)}`}
                                  >
                                    <div className="font-semibold tracking-tight leading-none">
                                      {shiftCode}
                                    </div>
                                    {timeLabel && (
                                      <div className="text-[9px] opacity-80 mt-0.5 leading-none">
                                        {timeLabel}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-slate-500">
              {t("noScheduleRows")}
            </div>
          )}
        </div>

        <SaveTemplateDialog
          open={showSaveTemplateDialog}
          onClose={() => setShowSaveTemplateDialog(false)}
          onSave={handleSaveTemplate}
          defaultName={scheduleTitle}
        />
      </div>

      {/* Success toast */}
      {templateSavedName && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium animate-in fade-in slide-in-from-bottom-4 duration-300">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Template &ldquo;{templateSavedName}&rdquo; saved</span>
        </div>
      )}
    </div>
  );
}
