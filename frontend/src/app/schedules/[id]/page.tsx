"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Save,
  Users,
} from "lucide-react";
import { fetchOptimizedScheduleByIdAPI } from "../../lib/api";
import { useOrganization } from "../../context/OrganizationContext";
import { useScheduleTemplates } from "../../scheduler/hooks/useScheduleTemplates";
import { SaveTemplateDialog } from "../../scheduler/components/ScheduleTemplateManager";

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
  const t = useTranslations("schedules");
  const locale = useLocale();
  const {
    isAdmin,
    getAuthHeaders,
    isLoading: orgLoading,
    currentOrganization,
  } = useOrganization();
  const backHref = isAdmin ? "/admin/schedules" : "/schedules";
  const backLabel = isAdmin
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
        if (!data.is_finalized && !isAdmin) {
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
  }, [scheduleId, isAdmin, orgLoading, currentOrganization, getAuthHeaders]);

  const parsed = useMemo(() => {
    if (!schedule) return { dates: [] as string[], rows: [] as GridRow[] };

    try {
      const raw =
        typeof schedule.schedule_data === "string"
          ? JSON.parse(schedule.schedule_data)
          : schedule.schedule_data || {};

      let dates: string[] = Array.isArray(raw?.dates) ? (raw.dates as string[]) : [];
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
              {schedule?.is_finalized && isAdmin && (
                <button
                  onClick={() => setShowSaveTemplateDialog(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 transition-colors"
                  title={t("saveAsTemplate")}
                >
                  <Save className="w-4 h-4" />
                  {t("saveAsTemplate")}
                </button>
              )}
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border bg-emerald-50 text-emerald-700 border-emerald-200">
                <CheckCircle2 className="w-4 h-4" />
                {schedule?.is_finalized ? t("finalized") : t("draft")}
              </div>
            </div>
          </div>

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
          <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
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

          {parsed.rows.length > 0 ? (
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
                  {parsed.rows.map((row, idx) => (
                    <tr key={row.id || idx}>
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 border-b border-slate-100 font-medium text-slate-800 text-xs">
                        {row.nurse || row.name || "Unknown"}
                      </td>
                      {(row.shifts || []).map((shift, shiftIdx) => {
                        const shiftCode = shift.shift || "—";
                        const timeLabel = getShiftTimeText(shift);
                        return (
                          <td
                            key={shiftIdx}
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
                  ))}
                </tbody>
              </table>
            </div>
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
