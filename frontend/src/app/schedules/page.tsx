"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { motion } from "framer-motion";
import { Calendar, Clock, Users, Eye, CheckCircle, Pencil } from "lucide-react";
import { fetchOptimizedSchedulesAPI, OptimizedSchedule } from "../lib/api";
import { useOrganization } from "../context/OrganizationContext";

export default function SchedulesPage() {
  const { user } = useUser();
  const { currentOrganization, isAdmin, getAuthHeaders } = useOrganization();
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
        const filtered = isAdmin
          ? data
          : data.filter((s: OptimizedSchedule) => s.is_finalized);
        setSchedules(filtered);
      } catch (err) {
        console.error("Failed to load schedules:", err);
        setError("Failed to load schedules");
      } finally {
        setLoading(false);
      }
    }
    loadSchedules();
  }, [isAdmin, getAuthHeaders]);

  const formatDate = (dateStr: string) => {
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

  return (
    <div className="page-frame">
      <div className="page-container py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="text-sm text-blue-600 hover:underline mb-1 inline-block"
          >
            ← Back to Dashboard
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                {isAdmin ? "All Schedules" : "Team Schedules"}
              </h1>
              <p className="text-gray-500 text-sm mt-1">
                {isAdmin
                  ? "View and manage all schedules"
                  : "View finalized schedules for your team"}
              </p>
            </div>
            {isAdmin && (
              <div className="flex items-center gap-2">
                <Link
                  href="/scheduler?manageTemplates=1"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  🗂 Manage Templates
                </Link>
                <Link
                  href="/scheduler?new=1"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  <Calendar className="w-4 h-4" />
                  Create New Schedule
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
        ) : schedules.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
            <Calendar className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              No Schedules Available
            </h3>
            <p className="text-gray-500 mb-6">
              {isAdmin
                ? "Create your first schedule using the Schedule Optimizer"
                : "No finalized schedules have been published yet"}
            </p>
            {isAdmin && (
              <div className="flex items-center justify-center gap-2">
                <Link
                  href="/scheduler?manageTemplates=1"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  🗂 Manage Templates
                </Link>
                <Link
                  href="/scheduler?new=1"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  <Calendar className="w-4 h-4" />
                  Create Schedule
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            {schedules.map((schedule, idx) => (
              <motion.div
                key={schedule.id}
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
                            Finalized
                          </span>
                        )}
                        {!schedule.is_finalized && isAdmin && (
                          <span className="text-amber-600">Draft</span>
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
                        View
                      </Link>
                    ) : isAdmin ? (
                      <Link
                        href={`/scheduler?scheduleId=${schedule.id}`}
                        className="flex items-center gap-2 px-4 py-2 text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-50 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                        Edit Draft
                      </Link>
                    ) : null}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
