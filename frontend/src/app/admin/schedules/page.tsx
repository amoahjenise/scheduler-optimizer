"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Calendar,
  Clock,
  Eye,
  Trash2,
  Plus,
  CheckCircle,
  XCircle,
  Building2,
  Users,
  Download,
} from "lucide-react";
import {
  deleteScheduleAPI,
  fetchOptimizedSchedulesAPI,
  OptimizedSchedule,
} from "../../lib/api";
import { useOrganization } from "../../context/OrganizationContext";

export default function AdminSchedulesPage() {
  const router = useRouter();
  const t = useTranslations("schedules");
  const {
    currentOrganization,
    isAdmin,
    isLoading: orgLoading,
    getAuthHeaders,
  } = useOrganization();
  const [schedules, setSchedules] = useState<OptimizedSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (orgLoading) return;

    if (!isAdmin) {
      router.replace("/schedules");
      return;
    }

    loadSchedules();
  }, [isAdmin, orgLoading]);

  async function loadSchedules() {
    try {
      setLoading(true);
      const authHeaders = await getAuthHeaders();
      const data = await fetchOptimizedSchedulesAPI(authHeaders);
      setSchedules(data);
      setError(null);
    } catch (err) {
      console.error("Failed to load schedules:", err);
      setError("Failed to load schedules");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(scheduleId: string) {
    try {
      const authHeaders = await getAuthHeaders();
      await deleteScheduleAPI(scheduleId, authHeaders);
      setSchedules(schedules.filter((s) => s.id !== scheduleId));
      setDeleteConfirm(null);
    } catch (err) {
      console.error("Failed to delete schedule:", err);
      alert("Failed to delete schedule");
    }
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "N/A";
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
      ? `${dateStr}T00:00:00`
      : dateStr;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return "N/A";
    return parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatDateRange = (start: string, end: string) => {
    if (!start || !end) return t("noDates");
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

  const getScheduleStats = (schedule: OptimizedSchedule) => {
    try {
      const data =
        typeof schedule.schedule_data === "string"
          ? JSON.parse(schedule.schedule_data)
          : schedule.schedule_data;

      const nurseCount = data.grid?.length || data.schedule?.length || 0;
      const dateCount = data.dates?.length || 0;

      return { nurseCount, dateCount };
    } catch {
      return { nurseCount: 0, dateCount: 0 };
    }
  };

  const getScheduleDisplayName = (schedule: OptimizedSchedule) => {
    const { start, end } = resolveRange(schedule);
    if (start && end) return `${formatDate(start)} - ${formatDate(end)}`;
    if (schedule.name && schedule.name.trim().length > 0) return schedule.name;
    return "Schedule";
  };

  if (orgLoading) {
    return null;
  }

  if (!isAdmin) {
    return null;
  }

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
                {t("scheduleManagement")}
              </h1>
              <p className="text-gray-500 text-sm mt-1">
                {t("viewCreateManageSchedules")}
              </p>
              {currentOrganization && (
                <div className="flex items-center gap-2 mt-2 text-sm text-gray-500">
                  <Building2 className="w-4 h-4" />
                  <span>{currentOrganization.name}</span>
                </div>
              )}
            </div>
            <Link
              href="/scheduler?new=1"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              {t("createNewSchedule")}
            </Link>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{t("totalSchedules")}</p>
                <p className="text-2xl font-bold text-gray-900">
                  {schedules.length}
                </p>
              </div>
              <Calendar className="w-8 h-8 text-emerald-500" />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{t("finalized")}</p>
                <p className="text-2xl font-bold text-emerald-600">
                  {schedules.filter((s) => s.is_finalized).length}
                </p>
              </div>
              <CheckCircle className="w-8 h-8 text-emerald-500" />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{t("drafts")}</p>
                <p className="text-2xl font-bold text-amber-600">
                  {schedules.filter((s) => !s.is_finalized).length}
                </p>
              </div>
              <XCircle className="w-8 h-8 text-amber-500" />
            </div>
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
            <button
              onClick={loadSchedules}
              className="ml-4 text-red-600 underline"
            >
              {t("retry")}
            </button>
          </div>
        ) : schedules.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
            <Calendar className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {t("noSchedulesCreatedYet")}
            </h3>
            <p className="text-gray-500 mb-6">{t("getStartedFirstSchedule")}</p>
            <Link
              href="/scheduler?new=1"
              className="inline-flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              {t("createFirstSchedule")}
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {schedules.map((schedule, idx) => {
              const stats = getScheduleStats(schedule);
              const range = resolveRange(schedule);
              const dateRangeLabel = formatDateRange(range.start, range.end);
              const displayName = getScheduleDisplayName(schedule);
              const showDateRange =
                dateRangeLabel !== t("noDates") &&
                displayName !== dateRangeLabel;
              return (
                <motion.div
                  key={schedule.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className="bg-white rounded-xl border border-gray-200 p-5 hover:border-emerald-300 hover:shadow-md transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4 flex-1">
                      <div
                        className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          schedule.is_finalized
                            ? "bg-emerald-100"
                            : "bg-amber-100"
                        }`}
                      >
                        <Calendar
                          className={`w-7 h-7 ${
                            schedule.is_finalized
                              ? "text-emerald-600"
                              : "text-amber-600"
                          }`}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-gray-900 text-lg">
                            {displayName}
                          </h3>
                          {schedule.is_finalized ? (
                            <span className="flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full">
                              <CheckCircle className="w-3 h-3" />
                              {t("finalized")}
                            </span>
                          ) : (
                            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
                              {t("draft")}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                          {showDateRange && (
                            <span className="flex items-center gap-1.5">
                              <Clock className="w-4 h-4 text-gray-400" />
                              {dateRangeLabel}
                            </span>
                          )}
                          {stats.nurseCount > 0 && (
                            <span className="flex items-center gap-1.5">
                              <Users className="w-4 h-4 text-gray-400" />
                              {stats.nurseCount} {t("nurses")}
                            </span>
                          )}
                          {stats.dateCount > 0 && (
                            <span className="text-gray-500">
                              {stats.dateCount} {t("days")}
                            </span>
                          )}
                          {schedule.organization_id && (
                            <span className="flex items-center gap-1.5 text-xs text-gray-400">
                              <Building2 className="w-3 h-3" />
                              {schedule.organization_id.substring(0, 8)}...
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-1 font-medium">
                          {t("createdOn")}{" "}
                          {new Date(schedule.created_at).toLocaleDateString()}{" "}
                          {t("at")}{" "}
                          {new Date(schedule.created_at).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                      {!schedule.is_finalized && (
                        <Link
                          href={`/scheduler?scheduleId=${schedule.id}`}
                          className="flex items-center gap-2 px-4 py-2 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-50 transition-colors"
                        >
                          {t("continue")}
                        </Link>
                      )}
                      {schedule.is_finalized && (
                        <Link
                          href={`/schedules/${schedule.id}`}
                          className="flex items-center gap-2 px-4 py-2 text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                          {t("view")}
                        </Link>
                      )}
                      {deleteConfirm === schedule.id ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleDelete(schedule.id)}
                            className="px-3 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
                          >
                            {t("confirm")}
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="px-3 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300"
                          >
                            {t("cancel")}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(schedule.id)}
                          className="p-2 text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                          title={t("deleteSchedule")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
