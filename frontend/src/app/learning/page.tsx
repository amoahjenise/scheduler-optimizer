"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  BookOpen,
  Play,
  CheckCircle,
  Clock,
  Award,
  ChevronRight,
  ArrowLeft,
  BarChart3,
  Users,
  GraduationCap,
  Filter,
  RefreshCw,
  Star,
  AlertTriangle,
  ClipboardList,
  ExternalLink,
  Plus,
  Trash2,
} from "lucide-react";
import { useOrganization } from "../context/OrganizationContext";
import { fetchAndCacheOrganizationConfig } from "../lib/orgConfig";
import {
  fetchLearningModulesAPI,
  fetchLearningModuleAPI,
  fetchMyLearningProgressAPI,
  startLearningModuleAPI,
  updateLearningProgressAPI,
  fetchLearningDashboardAPI,
  fetchLearningAssignmentsAPI,
  createLearningAssignmentAPI,
  deleteLearningAssignmentAPI,
  completeLearningAssignmentAPI,
  type LearningModule,
  type LearningProgress,
  type LearningDashboard,
  type NurseOnboardingStatus,
  type LearningAssignment,
} from "../lib/api";

const CATEGORY_COLORS: Record<string, string> = {
  medication_admin: "bg-purple-100 text-purple-700",
  patient_assessment: "bg-blue-100 text-blue-700",
  documentation: "bg-teal-100 text-teal-700",
  safety_protocols: "bg-red-100 text-red-700",
  equipment: "bg-orange-100 text-orange-700",
  communication: "bg-yellow-100 text-yellow-700",
  infection_control: "bg-green-100 text-green-700",
  emergency_response: "bg-red-100 text-red-800",
  cultural_competency: "bg-indigo-100 text-indigo-700",
  general_orientation: "bg-gray-100 text-gray-700",
};

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "text-green-600",
  intermediate: "text-yellow-600",
  advanced: "text-red-600",
};

const CONTENT_TYPE_ICONS: Record<string, React.ReactNode> = {
  interactive: <Play className="w-4 h-4" />,
  video: <Play className="w-4 h-4" />,
  quiz: <Award className="w-4 h-4" />,
  checklist: <CheckCircle className="w-4 h-4" />,
  simulation: <GraduationCap className="w-4 h-4" />,
};

export default function MicroLearningPage() {
  const { getAuthHeaders, canManage, currentOrganization } = useOrganization();
  const t = useTranslations("learning");

  const [modules, setModules] = useState<LearningModule[]>([]);
  const [progress, setProgress] = useState<LearningProgress[]>([]);
  const [dashboard, setDashboard] = useState<LearningDashboard | null>(null);
  const [assignments, setAssignments] = useState<LearningAssignment[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentDraft, setAssignmentDraft] = useState({
    title: "",
    description: "",
    assignment_type: "reading" as "module" | "link" | "reading",
    module_id: "",
    url: "",
    target_team: "",
    due_date: "",
  });
  const [selectedModule, setSelectedModule] = useState<LearningModule | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [view, setView] = useState<
    "catalog" | "progress" | "assignments" | "dashboard"
  >(canManage ? "dashboard" : "catalog");

  const loadData = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const [modulesData, progressData] = await Promise.all([
        fetchLearningModulesAPI({}, headers),
        fetchMyLearningProgressAPI(headers),
      ]);
      setModules(modulesData.modules);
      setProgress(progressData);

      try {
        setAssignments(await fetchLearningAssignmentsAPI(headers));
      } catch {
        setAssignments([]);
      }

      if (currentOrganization?.id) {
        try {
          const config = await fetchAndCacheOrganizationConfig(
            currentOrganization.id,
            headers,
          );
          setTeams(config.team_options);
        } catch {
          setTeams([]);
        }
      }

      if (canManage) {
        const dashData = await fetchLearningDashboardAPI(headers);
        setDashboard(dashData);
      }
    } catch {
      // Silently handle
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, canManage, currentOrganization?.id]);

  const createAssignment = async () => {
    if (!assignmentDraft.title.trim()) {
      setError("Assignment title is required");
      return;
    }
    if (
      assignmentDraft.assignment_type === "module" &&
      !assignmentDraft.module_id
    ) {
      setError("Select a module for module assignments");
      return;
    }
    if (
      assignmentDraft.assignment_type !== "module" &&
      !assignmentDraft.url.trim()
    ) {
      setError("A URL is required for link and reading assignments");
      return;
    }

    setAssignmentSaving(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      await createLearningAssignmentAPI(
        {
          title: assignmentDraft.title.trim(),
          description: assignmentDraft.description.trim() || undefined,
          assignment_type: assignmentDraft.assignment_type,
          module_id: assignmentDraft.module_id || undefined,
          url: assignmentDraft.url.trim() || undefined,
          target_team: assignmentDraft.target_team || null,
          due_date: assignmentDraft.due_date
            ? new Date(`${assignmentDraft.due_date}T23:59:59`).toISOString()
            : null,
        },
        headers,
      );
      setAssignmentDraft({
        title: "",
        description: "",
        assignment_type: "reading",
        module_id: "",
        url: "",
        target_team: "",
        due_date: "",
      });
      setShowAssignmentForm(false);
      setAssignments(await fetchLearningAssignmentsAPI(headers));
    } catch (err: any) {
      setError(err?.message || "Failed to create assignment");
    } finally {
      setAssignmentSaving(false);
    }
  };

  const completeAssignment = async (assignmentId: string) => {
    setError(null);
    try {
      const headers = await getAuthHeaders();
      await completeLearningAssignmentAPI(assignmentId, headers);
      setAssignments(await fetchLearningAssignmentsAPI(headers));
    } catch (err: any) {
      setError(err?.message || "Failed to mark assignment complete");
    }
  };

  const removeAssignment = async (assignment: LearningAssignment) => {
    if (!confirm(`Delete assignment "${assignment.title}"?`)) return;
    try {
      const headers = await getAuthHeaders();
      await deleteLearningAssignmentAPI(assignment.id, headers);
      setAssignments(await fetchLearningAssignmentsAPI(headers));
    } catch (err: any) {
      setError(err?.message || "Failed to delete assignment");
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getModuleProgress = (moduleId: string) => {
    return progress.find((p) => p.module_id === moduleId);
  };

  const startModule = async (moduleId: string) => {
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const prog = await startLearningModuleAPI(moduleId, headers);
      setProgress((prev) => [
        ...prev.filter((p) => p.module_id !== moduleId),
        prog,
      ]);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const completeModule = async (moduleId: string) => {
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const prog = await updateLearningProgressAPI(
        moduleId,
        { progress_percentage: 100 },
        headers,
      );
      setProgress((prev) => [
        ...prev.filter((p) => p.module_id !== moduleId),
        prog,
      ]);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const filteredModules =
    filter === "all" ? modules : modules.filter((m) => m.category === filter);
  const categories = [...new Set(modules.map((m) => m.category))];
  const completedCount = progress.filter(
    (p) => p.status === "completed",
  ).length;
  const inProgressCount = progress.filter(
    (p) => p.status === "in_progress",
  ).length;

  // Module Detail View
  if (selectedModule) {
    const prog = getModuleProgress(selectedModule.id);
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 py-8">
          <button
            onClick={() => setSelectedModule(null)}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
          >
            <ArrowLeft className="w-4 h-4" /> {t("backToCatalog")}
          </button>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <span
                  className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium mb-2 ${CATEGORY_COLORS[selectedModule.category] ?? "bg-gray-100 text-gray-600"}`}
                >
                  {selectedModule.category.replace(/_/g, " ")}
                </span>
                <h1 className="text-xl font-bold text-gray-900">
                  {selectedModule.title}
                </h1>
                <p className="text-gray-500 mt-1">
                  {selectedModule.description}
                </p>
              </div>
              {CONTENT_TYPE_ICONS[selectedModule.content_type]}
            </div>

            <div className="flex items-center gap-4 text-sm text-gray-500 mb-6">
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />{" "}
                {selectedModule.estimated_duration_minutes} min
              </span>
              <span
                className={DIFFICULTY_COLORS[selectedModule.difficulty_level]}
              >
                {selectedModule.difficulty_level}
              </span>
              {selectedModule.passing_score && (
                <span className="flex items-center gap-1">
                  <Star className="w-4 h-4" /> {t("passingScore")}:{" "}
                  {selectedModule.passing_score}%
                </span>
              )}
            </div>

            {/* Progress */}
            {prog && (
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-gray-600">{t("yourProgress")}</span>
                  <span className="font-medium text-gray-900">
                    {prog.progress_percentage}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div
                    className="h-2.5 rounded-full bg-blue-500 transition-all"
                    style={{ width: `${prog.progress_percentage}%` }}
                  />
                </div>
                {prog.quiz_score !== null && prog.quiz_score !== undefined && (
                  <p className="text-xs text-gray-500 mt-2">
                    {t("quizScore")}: {prog.quiz_score}%
                  </p>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
              {!prog && (
                <button
                  onClick={() => startModule(selectedModule.id)}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                >
                  <Play className="w-5 h-5" /> {t("startModule")}
                </button>
              )}
              {prog && prog.status === "in_progress" && (
                <button
                  onClick={() => completeModule(selectedModule.id)}
                  className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                >
                  <CheckCircle className="w-5 h-5" /> {t("markComplete")}
                </button>
              )}
              {prog && prog.status === "completed" && (
                <div className="flex items-center gap-2 px-6 py-3 bg-green-50 text-green-700 rounded-lg font-medium">
                  <CheckCircle className="w-5 h-5" /> {t("completed")}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main View
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
            <p className="text-gray-500 mt-1">{t("subtitle")}</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-blue-600 mb-1">
              <BookOpen className="w-4 h-4" />
              <span className="text-xs font-medium">{t("available")}</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{modules.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-yellow-600 mb-1">
              <RefreshCw className="w-4 h-4" />
              <span className="text-xs font-medium">{t("inProgress")}</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {inProgressCount}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-green-600 mb-1">
              <CheckCircle className="w-4 h-4" />
              <span className="text-xs font-medium">{t("completedLabel")}</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{completedCount}</p>
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          <button
            onClick={() => setView("catalog")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${view === "catalog" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
          >
            <BookOpen className="w-4 h-4 inline mr-1.5" /> {t("catalog")}
          </button>
          <button
            onClick={() => setView("progress")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${view === "progress" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
          >
            <BarChart3 className="w-4 h-4 inline mr-1.5" /> {t("myProgress")}
          </button>
          <button
            onClick={() => setView("assignments")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${view === "assignments" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
          >
            <ClipboardList className="w-4 h-4 inline mr-1.5" /> Assignments
          </button>
          {canManage && (
            <button
              onClick={() => setView("dashboard")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${view === "dashboard" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
            >
              <Users className="w-4 h-4 inline mr-1.5" />{" "}
              {t("managerDashboard")}
            </button>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="h-48 bg-white rounded-xl border border-gray-200 animate-pulse"
              />
            ))}
          </div>
        ) : view === "catalog" ? (
          <>
            {/* Filters */}
            <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2">
              <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <button
                onClick={() => setFilter("all")}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${filter === "all" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                {t("all")}
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${filter === cat ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                >
                  {cat.replace(/_/g, " ")}
                </button>
              ))}
            </div>

            {/* Module Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredModules.map((mod) => {
                const prog = getModuleProgress(mod.id);
                return (
                  <button
                    key={mod.id}
                    onClick={() => setSelectedModule(mod)}
                    className="text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[mod.category] ?? "bg-gray-100 text-gray-600"}`}
                      >
                        {mod.category.replace(/_/g, " ")}
                      </span>
                      {prog?.status === "completed" && (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      )}
                      {prog?.status === "in_progress" && (
                        <RefreshCw className="w-4 h-4 text-blue-500" />
                      )}
                    </div>
                    <h3 className="font-semibold text-gray-900 text-sm mb-1">
                      {mod.title}
                    </h3>
                    <p className="text-xs text-gray-500 line-clamp-2 mb-3">
                      {mod.description}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span className="flex items-center gap-1">
                        {CONTENT_TYPE_ICONS[mod.content_type]}{" "}
                        {mod.content_type}
                      </span>
                      <span>
                        <Clock className="w-3 h-3 inline" />{" "}
                        {mod.estimated_duration_minutes}m
                      </span>
                      <span className={DIFFICULTY_COLORS[mod.difficulty_level]}>
                        {mod.difficulty_level}
                      </span>
                    </div>
                    {prog && prog.status === "in_progress" && (
                      <div className="mt-3">
                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full bg-blue-500"
                            style={{ width: `${prog.progress_percentage}%` }}
                          />
                        </div>
                      </div>
                    )}
                    <ChevronRight className="w-4 h-4 text-gray-300 mt-2 ml-auto" />
                  </button>
                );
              })}
            </div>
            {filteredModules.length === 0 && (
              <div className="py-12 text-center">
                <BookOpen className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-400">{t("noModules")}</p>
              </div>
            )}
          </>
        ) : view === "progress" ? (
          /* My Progress View */
          <div className="space-y-3">
            {progress.length === 0 ? (
              <div className="py-12 text-center bg-white rounded-xl border border-gray-200">
                <GraduationCap className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500">{t("noProgress")}</p>
                <p className="text-sm text-gray-400 mt-1">
                  {t("startLearningHint")}
                </p>
              </div>
            ) : (
              progress.map((prog) => {
                const mod = modules.find((m) => m.id === prog.module_id);
                if (!mod) return null;
                return (
                  <button
                    key={prog.id}
                    onClick={() => setSelectedModule(mod)}
                    className="w-full text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center ${prog.status === "completed" ? "bg-green-100" : "bg-blue-100"}`}
                      >
                        {prog.status === "completed" ? (
                          <CheckCircle className="w-5 h-5 text-green-600" />
                        ) : (
                          <Play className="w-5 h-5 text-blue-600" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {mod.title}
                        </p>
                        <p className="text-xs text-gray-400">
                          {mod.category.replace(/_/g, " ")} ·{" "}
                          {mod.estimated_duration_minutes}m
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-gray-900">
                          {prog.progress_percentage}%
                        </p>
                        {prog.quiz_score !== null &&
                          prog.quiz_score !== undefined && (
                            <p className="text-xs text-gray-400">
                              {t("quiz")}: {prog.quiz_score}%
                            </p>
                          )}
                      </div>
                    </div>
                    {prog.status === "in_progress" && (
                      <div className="mt-2 w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full bg-blue-500"
                          style={{ width: `${prog.progress_percentage}%` }}
                        />
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        ) : view === "assignments" ? (
          <div className="space-y-4">
            {canManage && (
              <div className="flex justify-end">
                <button
                  onClick={() => setShowAssignmentForm((prev) => !prev)}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4" /> New assignment
                </button>
              </div>
            )}

            {canManage && showAssignmentForm && (
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="mb-4 text-lg font-semibold text-gray-900">
                  Assign learning
                </h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Type
                      </label>
                      <select
                        value={assignmentDraft.assignment_type}
                        onChange={(e) =>
                          setAssignmentDraft((prev) => ({
                            ...prev,
                            assignment_type: e.target
                              .value as typeof prev.assignment_type,
                          }))
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="reading">Reading</option>
                        <option value="link">Link</option>
                        <option value="module">Module</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Assign to
                      </label>
                      <select
                        value={assignmentDraft.target_team}
                        onChange={(e) =>
                          setAssignmentDraft((prev) => ({
                            ...prev,
                            target_team: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="">Entire organization</option>
                        {teams.map((team) => (
                          <option key={team} value={team}>
                            {team}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Title
                    </label>
                    <input
                      type="text"
                      value={assignmentDraft.title}
                      onChange={(e) =>
                        setAssignmentDraft((prev) => ({
                          ...prev,
                          title: e.target.value,
                        }))
                      }
                      placeholder="e.g., Read updated chemo spill protocol"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>

                  {assignmentDraft.assignment_type === "module" ? (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Module
                      </label>
                      <select
                        value={assignmentDraft.module_id}
                        onChange={(e) =>
                          setAssignmentDraft((prev) => ({
                            ...prev,
                            module_id: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="">Select a module</option>
                        {modules.map((mod) => (
                          <option key={mod.id} value={mod.id}>
                            {mod.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        URL
                      </label>
                      <input
                        type="url"
                        value={assignmentDraft.url}
                        onChange={(e) =>
                          setAssignmentDraft((prev) => ({
                            ...prev,
                            url: e.target.value,
                          }))
                        }
                        placeholder="https://..."
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Due date (optional)
                      </label>
                      <input
                        type="date"
                        value={assignmentDraft.due_date}
                        onChange={(e) =>
                          setAssignmentDraft((prev) => ({
                            ...prev,
                            due_date: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Notes (optional)
                      </label>
                      <input
                        type="text"
                        value={assignmentDraft.description}
                        onChange={(e) =>
                          setAssignmentDraft((prev) => ({
                            ...prev,
                            description: e.target.value,
                          }))
                        }
                        placeholder="Short context for the team"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={createAssignment}
                      disabled={assignmentSaving}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {assignmentSaving ? "Assigning..." : "Assign"}
                    </button>
                    <button
                      onClick={() => setShowAssignmentForm(false)}
                      className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {assignments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
                <ClipboardList className="mx-auto h-8 w-8 text-gray-400" />
                <p className="mt-3 font-medium text-gray-700">
                  No assignments yet
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {canManage
                    ? "Assign a module, link, or reading to your teams."
                    : "You have no assigned learning right now."}
                </p>
              </div>
            ) : (
              assignments.map((assignment) => {
                const overdue =
                  !!assignment.due_date &&
                  !assignment.completed_by_me &&
                  new Date(assignment.due_date).getTime() < Date.now();

                return (
                  <div
                    key={assignment.id}
                    className="rounded-xl border border-gray-200 bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium capitalize text-gray-700">
                            {assignment.assignment_type}
                          </span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                            {assignment.target_team || "Entire organization"}
                          </span>
                          {assignment.due_date && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                overdue
                                  ? "bg-red-100 text-red-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              Due{" "}
                              {new Date(
                                assignment.due_date,
                              ).toLocaleDateString()}
                            </span>
                          )}
                          {assignment.completed_by_me && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                              <CheckCircle className="h-3 w-3" /> Completed
                            </span>
                          )}
                        </div>

                        <p className="mt-2 font-medium text-gray-900">
                          {assignment.title}
                        </p>
                        {assignment.description && (
                          <p className="mt-1 text-sm text-gray-600">
                            {assignment.description}
                          </p>
                        )}
                        {assignment.url && (
                          <a
                            href={assignment.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
                          >
                            Open resource{" "}
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {canManage && (
                          <p className="mt-2 text-xs text-gray-500">
                            {assignment.completed_count} completed
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {!assignment.completed_by_me && (
                          <button
                            onClick={() => completeAssignment(assignment.id)}
                            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                          >
                            Mark done
                          </button>
                        )}
                        {canManage && (
                          <button
                            onClick={() => removeAssignment(assignment)}
                            className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-600 hover:bg-red-100"
                            title="Delete assignment"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          /* Manager Dashboard */
          dashboard && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 mb-1">
                    {t("totalModules")}
                  </p>
                  <p className="text-2xl font-bold text-gray-900">
                    {dashboard.modules_available}
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 mb-1">
                    {t("avgCompletion")}
                  </p>
                  <p className="text-2xl font-bold text-gray-900">
                    {Math.round(
                      (dashboard.fully_onboarded /
                        Math.max(dashboard.total_nurses, 1)) *
                        100,
                    )}
                    %
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 mb-1">
                    {t("activeNurses")}
                  </p>
                  <p className="text-2xl font-bold text-gray-900">
                    {dashboard.in_progress}
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 mb-1">
                    {t("fullyOnboarded")}
                  </p>
                  <p className="text-2xl font-bold text-gray-900">
                    {dashboard.fully_onboarded}
                  </p>
                </div>
              </div>

              {/* Onboarding Status */}
              {dashboard.nurse_statuses.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">
                    {t("onboardingProgress")}
                  </h3>
                  <div className="space-y-3">
                    {dashboard.nurse_statuses.map(
                      (nurse: NurseOnboardingStatus) => (
                        <div
                          key={nurse.nurse_id}
                          className="flex items-center gap-3"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {nurse.nurse_name}
                            </p>
                            <p className="text-xs text-gray-400">
                              {nurse.completed_modules}/{nurse.total_modules}{" "}
                              {t("modulesCompleted")}
                            </p>
                          </div>
                          <div className="w-32">
                            <div className="w-full bg-gray-100 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${nurse.completion_percentage >= 100 ? "bg-green-500" : "bg-blue-500"}`}
                                style={{
                                  width: `${Math.min(nurse.completion_percentage, 100)}%`,
                                }}
                              />
                            </div>
                          </div>
                          <span className="text-sm font-medium text-gray-900 w-12 text-right">
                            {Math.round(nurse.completion_percentage)}%
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
