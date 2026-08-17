"use client";

import { useState, useEffect, useMemo } from "react";
import { useUser } from "@clerk/nextjs";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { motion } from "framer-motion";
import { Calendar, Clock, Users, Eye, CheckCircle, Pencil } from "lucide-react";
import { fetchOptimizedSchedulesAPI, OptimizedSchedule } from "../lib/api";
import { useOrganization } from "../context/OrganizationContext";

export default function SchedulesPage() {
  const { user } = useUser();
  const t = useTranslations("schedules");
  const locale = useLocale();
  const {
    currentOrganization,
    canManage,
    getAuthHeaders,
    isLoading: orgLoading,
  } = useOrganization();
  const [schedules, setSchedules] = useState<OptimizedSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSchedules() {
      try {
        setLoading(true);
        const authHeaders = await getAuthHeaders();
        const data = await fetchOptimizedSchedulesAPI(authHeaders);
        // Filter to only show finalized schedules for non-admins
        const filtered = canManage
          ? data
          : data.filter((s: OptimizedSchedule) => s.is_finalized);
        setSchedules(filtered);
      } catch (err) {
        console.error("Failed to load schedules:", err);
        setError(t("failedToLoadSchedules"));
      } finally {
        setLoading(false);
      }
    }
    if (user?.id && !orgLoading && currentOrganization) {
      loadSchedules();
    }
  }, [user?.id, canManage, orgLoading, currentOrganization, getAuthHeaders]);

  const formatDate = (dateStr: string) => {
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
  };

  const formatDateRange = (start: string, end: string) => {
    return `${formatDate(start)} - ${formatDate(end)}`;
  };

  const resolveRange = (schedule: OptimizedSchedule) => {
    try {
      const raw =
        typeof schedule.schedule_data === "string"
          ? JSON.parse(schedule.schedule_data)
          : schedule.schedule_data || {};
      const draftState =
        raw && typeof raw.draft_state === "object" ? raw.draft_state : {};

      const dates = Array.isArray((raw as any)?.dates)
        ? (raw as any).dates
        : Array.isArray((draftState as any)?.ocrDates)
          ? (draftState as any).ocrDates
          : [];
      const start =
        (draftState as any)?.startDate ||
        schedule.start_date ||
        (raw as any)?.start_date ||
        (raw as any)?.dateRange?.start ||
        (dates.length ? dates[0] : "");
      const end =
        (draftState as any)?.endDate ||
        schedule.end_date ||
        (raw as any)?.end_date ||
        (raw as any)?.dateRange?.end ||
        (dates.length ? dates[dates.length - 1] : "");
      return { start, end };
    } catch {
      return { start: schedule.start_date || "", end: schedule.end_date || "" };
    }
  };

  const getScheduleDisplayName = (schedule: OptimizedSchedule) => {
    const { start, end } = resolveRange(schedule);
    if (start && end) return `${formatDate(start)} - ${formatDate(end)}`;
    if (schedule.name && schedule.name.trim().length > 0) return schedule.name;
    return "Schedule";
  };

  const groupedSchedules = useMemo(() => {
    type Group = {
      key: string;
      active: OptimizedSchedule;
      versions: OptimizedSchedule[];
    };

    const groups = new Map<string, OptimizedSchedule[]>();

    const getRevisionRootId = (schedule: OptimizedSchedule) => {
      try {
        const raw =
          typeof schedule.schedule_data === "string"
            ? JSON.parse(schedule.schedule_data)
            : schedule.schedule_data || {};
        const root =
          (raw as any)?.revision_of || (raw as any)?.draft_state?.revision_of;
        return typeof root === "string" && root.length > 0 ? root : schedule.id;
      } catch {
        return schedule.id;
      }
    };

    for (const schedule of schedules) {
      const rootId = getRevisionRootId(schedule);
      const range = resolveRange(schedule);
      const groupKey = `${rootId}:${range.start}:${range.end}`;
      const existing = groups.get(groupKey) || [];
      existing.push(schedule);
      groups.set(groupKey, existing);
    }

    const normalized: Group[] = Array.from(groups.entries()).map(
      ([key, versions]) => {
        const sorted = [...versions].sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        const active = sorted.find((s) => s.is_finalized) || sorted[0];
        return { key, active, versions: sorted };
      },
    );

    return normalized.sort(
      (a, b) =>
        new Date(b.active.created_at).getTime() -
        new Date(a.active.created_at).getTime(),
    );
  }, [schedules]);

  return (
    <div className="page-frame">
      <div className="page-container py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="text-sm text-blue-600 hover:underline mb-1 inline-block"
          >
            {t("backToDashboard")}
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                {canManage ? t("allSchedules") : t("teamSchedules")}
              </h1>
              <p className="text-gray-500 text-sm mt-1">
                {canManage
                  ? t("viewManageAllSchedules")
                  : t("viewFinalizedSchedules")}
              </p>
            </div>
            {canManage && (
              <div className="flex items-center gap-2">
                <Link
                  href="/scheduler?manageTemplates=1"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  {t("manageTemplates")}
                </Link>
                <Link
                  href="/scheduler?new=1"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  <Calendar className="w-4 h-4" />
                  {t("createNewSchedule")}
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-xl">
            {error}
          </div>
        ) : groupedSchedules.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
            <Calendar className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {t("noSchedulesAvailable")}
            </h3>
            <p className="text-gray-500 mb-6">
              {canManage ? t("noSchedulesDesc") : t("noSchedulesNonAdminDesc")}
            </p>
            {canManage && (
              <div className="flex items-center justify-center gap-2">
                <Link
                  href="/scheduler?manageTemplates=1"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  {t("manageTemplates")}
                </Link>
                <Link
                  href="/scheduler?new=1"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  <Calendar className="w-4 h-4" />
                  {t("createSchedule")}
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            {groupedSchedules.map((group, idx) => {
              const schedule = group.active;
              const otherVersions = group.versions.filter(
                (version) => version.id !== schedule.id,
              );
              return (
                <motion.div
                  key={group.key}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="bg-white rounded-xl border border-gray-200 p-5 hover:border-emerald-300 hover:shadow-md transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div
                        className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                          schedule.is_finalized
                            ? "bg-emerald-100"
                            : "bg-amber-100"
                        }`}
                      >
                        <Calendar
                          className={`w-6 h-6 ${
                            schedule.is_finalized
                              ? "text-emerald-600"
                              : "text-amber-600"
                          }`}
                        />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          {getScheduleDisplayName(schedule)}
                        </h3>
                        <div className="flex items-center gap-3 text-sm text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {formatDateRange(
                              resolveRange(schedule).start,
                              resolveRange(schedule).end,
                            )}
                          </span>
                          {schedule.is_finalized && (
                            <span className="flex items-center gap-1 text-emerald-600">
                              <CheckCircle className="w-3.5 h-3.5" />
                              {t("finalized")}
                            </span>
                          )}
                          {!schedule.is_finalized && canManage && (
                            <span className="text-amber-600">{t("draft")}</span>
                          )}
                          {group.versions.length > 1 && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                              {group.versions.length} versions
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {schedule.is_finalized ? (
                        <Link
                          href={`/schedules/${schedule.id}`}
                          className="flex items-center gap-2 px-4 py-2 text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                          {t("view")}
                        </Link>
                      ) : canManage ? (
                        <Link
                          href={`/scheduler?scheduleId=${schedule.id}`}
                          className="flex items-center gap-2 px-4 py-2 text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-50 transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                          {t("editDraft")}
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  {otherVersions.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span>Other versions:</span>
                      {otherVersions.map((version) => (
                        <Link
                          key={version.id}
                          href={
                            version.is_finalized
                              ? `/schedules/${version.id}`
                              : `/scheduler?scheduleId=${version.id}`
                          }
                          className="px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
                        >
                          {new Date(version.created_at).toLocaleDateString(
                            locale,
                            {
                              month: "short",
                              day: "numeric",
                            },
                          )}
                          {version.is_finalized ? " (final)" : " (draft)"}
                        </Link>
                      ))}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
