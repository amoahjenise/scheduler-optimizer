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
  Pencil,
  Trash2,
} from "lucide-react";
import { useOrganization } from "../context/OrganizationContext";
import { fetchAndCacheOrganizationConfig } from "../lib/orgConfig";
import {
  fetchLearningModulesAPI,
  createLearningModuleAPI,
  updateLearningModuleAPI,
  deleteLearningModuleAPI,
  fetchMyLearningProgressAPI,
  startLearningModuleAPI,
  updateLearningProgressAPI,
  fetchLearningDashboardAPI,
  fetchLearningAssignmentsAPI,
  createLearningAssignmentAPI,
  updateLearningAssignmentAPI,
  deleteLearningAssignmentAPI,
  completeLearningAssignmentAPI,
  fetchAssignmentCompletionsAPI,
  type LearningModule,
  type LearningProgress,
  type LearningDashboard,
  type NurseOnboardingStatus,
  type LearningAssignment,
  type AssignmentCompletion,
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
  const {
    getAuthHeaders,
    canManage,
    currentOrganization,
    isLoading: orgLoading,
  } = useOrganization();
  const t = useTranslations("learning");

  const [modules, setModules] = useState<LearningModule[]>([]);
  const [progress, setProgress] = useState<LearningProgress[]>([]);
  const [dashboard, setDashboard] = useState<LearningDashboard | null>(null);
  const [assignments, setAssignments] = useState<LearningAssignment[]>([]);
  const [assignmentCompletions, setAssignmentCompletions] = useState<
    Record<string, AssignmentCompletion[]>
  >({});
  const [expandedAssignmentId, setExpandedAssignmentId] = useState<
    string | null
  >(null);
  const [completionLoadingId, setCompletionLoadingId] = useState<string | null>(
    null,
  );
  const [teams, setTeams] = useState<string[]>([]);
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(
    null,
  );
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [showModuleForm, setShowModuleForm] = useState(false);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [moduleSaving, setModuleSaving] = useState(false);
  const [moduleDraft, setModuleDraft] = useState({
    title: "",
    description: "",
    category: "orientation",
    content_type: "interactive" as
      | "interactive"
      | "video"
      | "quiz"
      | "checklist"
      | "simulation",
    estimated_duration_minutes: 10,
    difficulty_level: "beginner" as "beginner" | "intermediate" | "advanced",
    is_mandatory: false,
    required_for_onboarding: false,
    is_published: true,
    passing_score: 0.8,
  });
  const [interactiveBuilderSteps, setInteractiveBuilderSteps] = useState<
    string[]
  >([""]);
  const [checklistBuilderItems, setChecklistBuilderItems] = useState<
    Array<{ text: string; critical: boolean }>
  >([{ text: "", critical: false }]);
  const [quizBuilderQuestions, setQuizBuilderQuestions] = useState<
    Array<{ text: string; optionsCsv: string; correctAnswer: string }>
  >([{ text: "", optionsCsv: "", correctAnswer: "" }]);
  const [moduleResourceUrl, setModuleResourceUrl] = useState("");
  const [assignmentDraft, setAssignmentDraft] = useState({
    title: "",
    description: "",
    assignment_type: "reading" as "module" | "link" | "reading",
    module_id: "",
    url: "",
    target_team: "",
    due_date: "",
    is_mandatory: true,
  });
  const [selectedModule, setSelectedModule] = useState<LearningModule | null>(
    null,
  );
  const [progressTrackingDisabled, setProgressTrackingDisabled] =
    useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [view, setView] = useState<
    "catalog" | "progress" | "assignments" | "dashboard"
  >(canManage ? "dashboard" : "catalog");
  const [onboardingSearch, setOnboardingSearch] = useState("");

  const loadData = useCallback(async () => {
    if (orgLoading || !currentOrganization?.id) {
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const [modulesResult, progressResult, assignmentsResult] =
        await Promise.allSettled([
          fetchLearningModulesAPI(
            canManage ? { published_only: false } : { published_only: true },
            headers,
          ),
          canManage
            ? Promise.resolve([] as LearningProgress[])
            : fetchMyLearningProgressAPI(headers),
          fetchLearningAssignmentsAPI(headers),
        ]);

      if (modulesResult.status === "fulfilled") {
        setModules(modulesResult.value.modules);
      } else {
        setModules([]);
      }

      if (progressResult.status === "fulfilled") {
        setProgress(progressResult.value);
      } else {
        setProgress([]);
      }

      if (assignmentsResult.status === "fulfilled") {
        setAssignments(assignmentsResult.value);
      } else {
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
  }, [getAuthHeaders, canManage, currentOrganization?.id, orgLoading]);

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
          is_mandatory: assignmentDraft.is_mandatory,
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
        is_mandatory: true,
      });
      setShowAssignmentForm(false);
      setAssignments(await fetchLearningAssignmentsAPI(headers));
    } catch (err: any) {
      setError(err?.message || "Failed to create assignment");
    } finally {
      setAssignmentSaving(false);
    }
  };

  const beginEditAssignment = (assignment: LearningAssignment) => {
    setEditingAssignmentId(assignment.id);
    setShowAssignmentForm(true);
    setAssignmentDraft({
      title: assignment.title,
      description: assignment.description ?? "",
      assignment_type: assignment.assignment_type,
      module_id: assignment.module_id ?? "",
      url: assignment.url ?? "",
      target_team: assignment.target_team ?? "",
      due_date: assignment.due_date
        ? new Date(assignment.due_date).toISOString().slice(0, 10)
        : "",
      is_mandatory: assignment.is_mandatory,
    });
  };

  const updateAssignment = async () => {
    if (!editingAssignmentId) return;
    if (!assignmentDraft.title.trim()) {
      setError("Assignment title is required");
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
      await updateLearningAssignmentAPI(
        editingAssignmentId,
        {
          title: assignmentDraft.title.trim(),
          description: assignmentDraft.description.trim() || undefined,
          target_team: assignmentDraft.target_team || null,
          due_date: assignmentDraft.due_date
            ? new Date(`${assignmentDraft.due_date}T23:59:59`).toISOString()
            : null,
          is_mandatory: assignmentDraft.is_mandatory,
          url:
            assignmentDraft.assignment_type === "module"
              ? undefined
              : assignmentDraft.url.trim() || undefined,
        },
        headers,
      );

      setAssignments(await fetchLearningAssignmentsAPI(headers));
      setShowAssignmentForm(false);
      setEditingAssignmentId(null);
      setAssignmentDraft({
        title: "",
        description: "",
        assignment_type: "reading",
        module_id: "",
        url: "",
        target_team: "",
        due_date: "",
        is_mandatory: true,
      });
    } catch (err: any) {
      setError(err?.message || "Failed to update assignment");
    } finally {
      setAssignmentSaving(false);
    }
  };

  const createModule = async () => {
    if (!moduleDraft.title.trim()) {
      setError("Module title is required");
      return;
    }

    setModuleSaving(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      let content: Record<string, unknown> = {};

      if (moduleDraft.content_type === "interactive") {
        const steps = interactiveBuilderSteps
          .map((step, idx) => ({
            id: `step-${idx + 1}`,
            type: "text",
            content: step.trim(),
          }))
          .filter((step) => step.content.length > 0);
        content = { steps };
      } else if (moduleDraft.content_type === "checklist") {
        const items = checklistBuilderItems
          .map((item, idx) => ({
            id: `item-${idx + 1}`,
            text: item.text.trim(),
            critical: item.critical,
          }))
          .filter((item) => item.text.length > 0);
        content = { items };
      } else if (moduleDraft.content_type === "quiz") {
        const questions = quizBuilderQuestions
          .map((q, idx) => {
            const options = q.optionsCsv
              .split(",")
              .map((opt) => opt.trim())
              .filter((opt) => opt.length > 0);
            return {
              id: `q-${idx + 1}`,
              text: q.text.trim(),
              type: "multiple_choice",
              options,
              correct_answer: q.correctAnswer.trim(),
            };
          })
          .filter(
            (q) =>
              q.text.length > 0 && q.options.length >= 2 && q.correct_answer,
          );
        content = { questions };
      } else if (moduleResourceUrl.trim()) {
        content = { url: moduleResourceUrl.trim() };
      }

      const payload = {
        title: moduleDraft.title.trim(),
        description: moduleDraft.description.trim() || null,
        category: moduleDraft.category,
        content_type: moduleDraft.content_type,
        content,
        estimated_duration_minutes: moduleDraft.estimated_duration_minutes,
        difficulty_level: moduleDraft.difficulty_level,
        required_for_onboarding: moduleDraft.required_for_onboarding,
        is_mandatory: moduleDraft.is_mandatory,
        is_published: moduleDraft.is_published,
        passing_score: moduleDraft.passing_score,
      };

      if (editingModuleId) {
        const updated = await updateLearningModuleAPI(
          editingModuleId,
          payload,
          headers,
        );
        setModules((prev) =>
          prev.map((mod) => (mod.id === editingModuleId ? updated : mod)),
        );
      } else {
        const module = await createLearningModuleAPI(payload, headers);
        setModules((prev) => [module, ...prev]);
      }

      setModuleDraft({
        title: "",
        description: "",
        category: "orientation",
        content_type: "interactive",
        estimated_duration_minutes: 10,
        difficulty_level: "beginner",
        is_mandatory: false,
        required_for_onboarding: false,
        is_published: true,
        passing_score: 0.8,
      });
      setInteractiveBuilderSteps([""]);
      setChecklistBuilderItems([{ text: "", critical: false }]);
      setQuizBuilderQuestions([
        { text: "", optionsCsv: "", correctAnswer: "" },
      ]);
      setModuleResourceUrl("");
      setEditingModuleId(null);
      setShowModuleForm(false);
    } catch (err: any) {
      setError(err?.message || "Failed to create module");
    } finally {
      setModuleSaving(false);
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

  const beginEditModule = (module: LearningModule) => {
    setEditingModuleId(module.id);
    setShowModuleForm(true);

    setModuleDraft({
      title: module.title,
      description: module.description || "",
      category: module.category,
      content_type: module.content_type,
      estimated_duration_minutes: module.estimated_duration_minutes,
      difficulty_level: module.difficulty_level,
      is_mandatory: module.is_mandatory,
      required_for_onboarding: module.required_for_onboarding,
      is_published: module.is_published,
      passing_score: module.passing_score,
    });

    if (module.content_type === "interactive") {
      const steps = Array.isArray(module.content?.steps)
        ? (module.content.steps as Array<{ content?: string }>).map(
            (s) => s.content || "",
          )
        : [];
      setInteractiveBuilderSteps(steps.length > 0 ? steps : [""]);
    } else {
      setInteractiveBuilderSteps([""]);
    }

    if (module.content_type === "checklist") {
      const items = Array.isArray(module.content?.items)
        ? (
            module.content.items as Array<{ text?: string; critical?: boolean }>
          ).map((item) => ({
            text: item.text || "",
            critical: !!item.critical,
          }))
        : [];
      setChecklistBuilderItems(
        items.length > 0 ? items : [{ text: "", critical: false }],
      );
    } else {
      setChecklistBuilderItems([{ text: "", critical: false }]);
    }

    if (module.content_type === "quiz") {
      const questions = Array.isArray(module.content?.questions)
        ? (
            module.content.questions as Array<{
              text?: string;
              options?: string[];
              correct_answer?: string;
            }>
          ).map((q) => ({
            text: q.text || "",
            optionsCsv: Array.isArray(q.options) ? q.options.join(", ") : "",
            correctAnswer: q.correct_answer || "",
          }))
        : [];
      setQuizBuilderQuestions(
        questions.length > 0
          ? questions
          : [{ text: "", optionsCsv: "", correctAnswer: "" }],
      );
    } else {
      setQuizBuilderQuestions([
        { text: "", optionsCsv: "", correctAnswer: "" },
      ]);
    }

    const maybeUrl =
      typeof module.content?.url === "string" ? module.content.url : "";
    setModuleResourceUrl(maybeUrl || "");
  };

  const removeModule = async (module: LearningModule) => {
    if (!confirm(`Delete module "${module.title}"?`)) return;
    setError(null);
    try {
      const headers = await getAuthHeaders();
      await deleteLearningModuleAPI(module.id, headers);
      setModules((prev) => prev.filter((m) => m.id !== module.id));
      if (selectedModule?.id === module.id) {
        setSelectedModule(null);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to delete module");
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

  const toggleAssignmentCompletions = async (assignmentId: string) => {
    if (expandedAssignmentId === assignmentId) {
      setExpandedAssignmentId(null);
      return;
    }

    setExpandedAssignmentId(assignmentId);

    if (assignmentCompletions[assignmentId]) {
      return;
    }

    setCompletionLoadingId(assignmentId);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const completions = await fetchAssignmentCompletionsAPI(
        assignmentId,
        headers,
      );
      setAssignmentCompletions((prev) => ({
        ...prev,
        [assignmentId]: completions,
      }));
    } catch (err: any) {
      setError(err?.message || "Failed to load completions");
    } finally {
      setCompletionLoadingId(null);
    }
  };

  useEffect(() => {
    if (orgLoading || !currentOrganization?.id) {
      return;
    }
    loadData();
  }, [loadData, orgLoading, currentOrganization?.id]);

  const getModuleProgress = (moduleId: string) => {
    return progress.find((p) => p.module_id === moduleId);
  };

  const startModule = async (moduleId: string) => {
    if (progressTrackingDisabled) return;
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const prog = await startLearningModuleAPI(moduleId, headers);
      setProgress((prev) => [
        ...prev.filter((p) => p.module_id !== moduleId),
        prog,
      ]);
    } catch (err: any) {
      const message = err?.message || "Failed to start module";
      if (message.toLowerCase().includes("nurse profile not found")) {
        setProgressTrackingDisabled(true);
        return;
      }
      setError(message);
    }
  };

  const completeModule = async (moduleId: string) => {
    if (progressTrackingDisabled) return;
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

  type InteractiveStep = {
    id?: string;
    type?: string;
    content?: string;
    media_url?: string;
  };

  type QuizQuestion = {
    id?: string;
    text?: string;
    options?: string[];
  };

  type ChecklistItem = {
    id?: string;
    text?: string;
    critical?: boolean;
  };

  const [interactiveStepIndex, setInteractiveStepIndex] = useState(0);
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>(
    {},
  );
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});

  const getInteractiveSteps = (module: LearningModule): InteractiveStep[] => {
    const raw = module.content?.steps;
    if (!Array.isArray(raw)) return [];
    return raw as InteractiveStep[];
  };

  const getChecklistItems = (module: LearningModule): ChecklistItem[] => {
    const raw = module.content?.items;
    if (!Array.isArray(raw)) return [];
    return raw as ChecklistItem[];
  };

  const getQuizQuestions = (module: LearningModule): QuizQuestion[] => {
    const raw = module.content?.questions;
    if (!Array.isArray(raw)) return [];
    return raw as QuizQuestion[];
  };

  const ensureModuleStarted = async (moduleId: string): Promise<void> => {
    if (progressTrackingDisabled) return;
    const existing = getModuleProgress(moduleId);
    if (existing) return;
    await startModule(moduleId);
  };

  const persistInteractiveProgress = async (
    moduleId: string,
    stepIndex: number,
    totalSteps: number,
  ) => {
    if (progressTrackingDisabled) return;
    const pct =
      totalSteps > 0 ? Math.round(((stepIndex + 1) / totalSteps) * 100) : 0;
    const headers = await getAuthHeaders();
    const prog = await updateLearningProgressAPI(
      moduleId,
      {
        current_step: stepIndex,
        progress_percentage: Math.min(100, Math.max(0, pct)),
      },
      headers,
    );
    setProgress((prev) => [
      ...prev.filter((p) => p.module_id !== moduleId),
      prog,
    ]);
  };

  const persistChecklistProgress = async (
    moduleId: string,
    nextState: Record<string, boolean>,
    totalItems: number,
  ) => {
    if (progressTrackingDisabled) return;
    const done = Object.values(nextState).filter(Boolean).length;
    const pct = totalItems > 0 ? Math.round((done / totalItems) * 100) : 0;
    const headers = await getAuthHeaders();
    const prog = await updateLearningProgressAPI(
      moduleId,
      {
        checklist_state: nextState,
        progress_percentage: Math.min(100, Math.max(0, pct)),
      },
      headers,
    );
    setProgress((prev) => [
      ...prev.filter((p) => p.module_id !== moduleId),
      prog,
    ]);
  };

  const submitQuiz = async (module: LearningModule) => {
    if (progressTrackingDisabled) return;
    setError(null);
    try {
      await ensureModuleStarted(module.id);
      const headers = await getAuthHeaders();
      const prog = await updateLearningProgressAPI(
        module.id,
        {
          quiz_answers: quizAnswers,
          progress_percentage: 100,
        },
        headers,
      );
      setProgress((prev) => [
        ...prev.filter((p) => p.module_id !== module.id),
        prog,
      ]);
    } catch (err: any) {
      setError(err.message || "Failed to submit quiz");
    }
  };

  useEffect(() => {
    if (!selectedModule) return;

    setInteractiveStepIndex(0);

    if (selectedModule.content_type === "checklist") {
      const items = getChecklistItems(selectedModule);
      const initial: Record<string, boolean> = {};
      items.forEach((item, idx) => {
        const key = item.id || `item-${idx}`;
        initial[key] = false;
      });
      setChecklistState(initial);
    } else {
      setChecklistState({});
    }

    if (selectedModule.content_type === "quiz") {
      setQuizAnswers({});
    }
  }, [selectedModule]);

  const filteredModules =
    filter === "all" ? modules : modules.filter((m) => m.category === filter);
  const categories = [...new Set(modules.map((m) => m.category))];
  const completedCount = progress.filter(
    (p) => p.status === "completed",
  ).length;
  const inProgressCount = progress.filter(
    (p) => p.status === "in_progress",
  ).length;
  const sortedNurseStatuses = [...(dashboard?.nurse_statuses || [])].sort(
    (a: NurseOnboardingStatus, b: NurseOnboardingStatus) =>
      a.nurse_name.localeCompare(b.nurse_name, undefined, {
        sensitivity: "base",
      }),
  );

  const filteredNurseStatuses = sortedNurseStatuses.filter(
    (nurse: NurseOnboardingStatus) =>
      nurse.nurse_name
        .toLocaleLowerCase()
        .includes(onboardingSearch.trim().toLocaleLowerCase()),
  );

  // Module Detail View
  if (selectedModule) {
    const module = selectedModule;
    const prog = getModuleProgress(module.id);
    const interactiveSteps = getInteractiveSteps(module);
    const checklistItems = getChecklistItems(module);
    const quizQuestions = getQuizQuestions(module);

    const handleInteractiveNext = async () => {
      setError(null);
      try {
        await ensureModuleStarted(module.id);
        const totalSteps = interactiveSteps.length;
        const nextIndex = Math.min(
          interactiveStepIndex + 1,
          Math.max(totalSteps - 1, 0),
        );
        setInteractiveStepIndex(nextIndex);
        if (totalSteps > 0) {
          await persistInteractiveProgress(module.id, nextIndex, totalSteps);
        }
      } catch (err: any) {
        setError(err.message || "Failed to update progress");
      }
    };

    const handleInteractivePrev = () => {
      setInteractiveStepIndex((prev) => Math.max(prev - 1, 0));
    };

    const handleChecklistToggle = async (itemKey: string, checked: boolean) => {
      setError(null);
      try {
        await ensureModuleStarted(module.id);
        const nextState = {
          ...checklistState,
          [itemKey]: checked,
        };
        setChecklistState(nextState);
        await persistChecklistProgress(
          module.id,
          nextState,
          checklistItems.length,
        );
      } catch (err: any) {
        setError(err.message || "Failed to update checklist progress");
      }
    };

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
                  className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium mb-2 ${CATEGORY_COLORS[module.category] ?? "bg-gray-100 text-gray-600"}`}
                >
                  {module.category.replace(/_/g, " ")}
                </span>
                <h1 className="text-xl font-bold text-gray-900">
                  {module.title}
                </h1>
                <p className="text-gray-500 mt-1">{module.description}</p>
              </div>
              {CONTENT_TYPE_ICONS[module.content_type]}
            </div>

            <div className="flex items-center gap-4 text-sm text-gray-500 mb-6">
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />{" "}
                {module.estimated_duration_minutes} min
              </span>
              <span className={DIFFICULTY_COLORS[module.difficulty_level]}>
                {module.difficulty_level}
              </span>
              {module.passing_score && (
                <span className="flex items-center gap-1">
                  <Star className="w-4 h-4" /> {t("passingScore")}:{" "}
                  {module.passing_score}%
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

            {/* Content Renderer */}
            <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
              {module.content_type === "interactive" && (
                <div className="space-y-4">
                  {interactiveSteps.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      This interactive module has no steps yet.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>
                          Step {interactiveStepIndex + 1} of{" "}
                          {interactiveSteps.length}
                        </span>
                        <span className="capitalize">
                          {interactiveSteps[interactiveStepIndex]?.type ||
                            "step"}
                        </span>
                      </div>
                      <div className="rounded-lg bg-white p-4 border border-gray-200">
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">
                          {interactiveSteps[interactiveStepIndex]?.content ||
                            "No content for this step."}
                        </p>
                        {interactiveSteps[interactiveStepIndex]?.media_url && (
                          <a
                            href={
                              interactiveSteps[interactiveStepIndex]?.media_url
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
                          >
                            Open media <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleInteractivePrev}
                          disabled={interactiveStepIndex === 0}
                          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
                        >
                          Previous
                        </button>
                        <button
                          onClick={handleInteractiveNext}
                          className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                        >
                          {interactiveStepIndex >= interactiveSteps.length - 1
                            ? "Finish step"
                            : "Next step"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {module.content_type === "checklist" && (
                <div className="space-y-3">
                  {checklistItems.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      This checklist module has no items yet.
                    </p>
                  ) : (
                    checklistItems.map((item, idx) => {
                      const key = item.id || `item-${idx}`;
                      const checked = !!checklistState[key];
                      return (
                        <label
                          key={key}
                          className="flex items-start gap-3 rounded-lg bg-white p-3 border border-gray-200"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              handleChecklistToggle(key, e.target.checked)
                            }
                            className="mt-0.5"
                          />
                          <span className="text-sm text-gray-700">
                            {item.text || "Checklist item"}
                            {item.critical && (
                              <span className="ml-2 text-xs font-medium text-red-600">
                                Critical
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              )}

              {module.content_type === "quiz" && (
                <div className="space-y-4">
                  {quizQuestions.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      This quiz module has no questions yet.
                    </p>
                  ) : (
                    <>
                      {quizQuestions.map((q, idx) => {
                        const qid = q.id || `q-${idx}`;
                        const options = Array.isArray(q.options)
                          ? q.options
                          : [];
                        return (
                          <div
                            key={qid}
                            className="rounded-lg bg-white p-4 border border-gray-200"
                          >
                            <p className="text-sm font-medium text-gray-900 mb-2">
                              {idx + 1}. {q.text || "Question"}
                            </p>
                            <div className="space-y-2">
                              {options.map((opt) => (
                                <label
                                  key={opt}
                                  className="flex items-center gap-2 text-sm text-gray-700"
                                >
                                  <input
                                    type="radio"
                                    name={`quiz-${qid}`}
                                    value={opt}
                                    checked={quizAnswers[qid] === opt}
                                    onChange={(e) =>
                                      setQuizAnswers((prev) => ({
                                        ...prev,
                                        [qid]: e.target.value,
                                      }))
                                    }
                                  />
                                  {opt}
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                      <button
                        onClick={() => submitQuiz(module)}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                      >
                        Submit quiz
                      </button>
                    </>
                  )}
                </div>
              )}

              {(module.content_type === "video" ||
                module.content_type === "simulation") && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-700">
                    This module type is ready for content. Add a URL or
                    structured data in the module content to render
                    media/scenario steps.
                  </p>
                  {module.content?.url && (
                    <a
                      href={String(module.content.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
                    >
                      Open module resource{" "}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              {!prog && !progressTrackingDisabled && (
                <button
                  onClick={() => startModule(module.id)}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                >
                  <Play className="w-5 h-5" /> {t("startModule")}
                </button>
              )}
              {prog &&
                prog.status === "in_progress" &&
                !progressTrackingDisabled && (
                  <button
                    onClick={() => completeModule(module.id)}
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
            {canManage && (
              <div className="mb-4 flex justify-end">
                <button
                  onClick={() => {
                    setEditingModuleId(null);
                    setModuleDraft({
                      title: "",
                      description: "",
                      category: "orientation",
                      content_type: "interactive",
                      estimated_duration_minutes: 10,
                      difficulty_level: "beginner",
                      is_mandatory: false,
                      required_for_onboarding: false,
                      is_published: true,
                      passing_score: 0.8,
                    });
                    setInteractiveBuilderSteps([""]);
                    setChecklistBuilderItems([{ text: "", critical: false }]);
                    setQuizBuilderQuestions([
                      { text: "", optionsCsv: "", correctAnswer: "" },
                    ]);
                    setModuleResourceUrl("");
                    setShowModuleForm((prev) => !prev);
                  }}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" /> New module
                </button>
              </div>
            )}

            {canManage && showModuleForm && (
              <div className="mb-4 rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="mb-4 text-lg font-semibold text-gray-900">
                  {editingModuleId ? "Edit module" : "Create module"}
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Title
                    </label>
                    <input
                      type="text"
                      value={moduleDraft.title}
                      onChange={(e) =>
                        setModuleDraft((prev) => ({
                          ...prev,
                          title: e.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      placeholder="e.g., Safe Narcotics Double-Check"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Description
                    </label>
                    <textarea
                      value={moduleDraft.description}
                      onChange={(e) =>
                        setModuleDraft((prev) => ({
                          ...prev,
                          description: e.target.value,
                        }))
                      }
                      rows={3}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      placeholder="Short summary for staff"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Category
                      </label>
                      <select
                        value={moduleDraft.category}
                        onChange={(e) =>
                          setModuleDraft((prev) => ({
                            ...prev,
                            category: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        {[
                          "orientation",
                          "safety",
                          "medication",
                          "equipment",
                          "charting",
                          "infection_control",
                          "patient_handling",
                          "emergency",
                          "compliance",
                          "specialty",
                        ].map((cat) => (
                          <option key={cat} value={cat}>
                            {cat.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Content type
                      </label>
                      <select
                        value={moduleDraft.content_type}
                        onChange={(e) =>
                          setModuleDraft((prev) => ({
                            ...prev,
                            content_type: e.target
                              .value as typeof prev.content_type,
                          }))
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        {[
                          "interactive",
                          "video",
                          "quiz",
                          "checklist",
                          "simulation",
                        ].map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Difficulty
                      </label>
                      <select
                        value={moduleDraft.difficulty_level}
                        onChange={(e) =>
                          setModuleDraft((prev) => ({
                            ...prev,
                            difficulty_level: e.target
                              .value as typeof prev.difficulty_level,
                          }))
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        {["beginner", "intermediate", "advanced"].map(
                          (level) => (
                            <option key={level} value={level}>
                              {level}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Duration (minutes)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={moduleDraft.estimated_duration_minutes}
                        onChange={(e) =>
                          setModuleDraft((prev) => ({
                            ...prev,
                            estimated_duration_minutes:
                              Number.parseInt(e.target.value || "10", 10) || 10,
                          }))
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Passing score
                      </label>
                      <select
                        value={moduleDraft.passing_score}
                        onChange={(e) =>
                          setModuleDraft((prev) => ({
                            ...prev,
                            passing_score: Number.parseFloat(e.target.value),
                          }))
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value={0.7}>70%</option>
                        <option value={0.8}>80%</option>
                        <option value={0.9}>90%</option>
                        <option value={1}>100%</option>
                      </select>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <p className="mb-3 text-sm font-semibold text-gray-800">
                      Content Builder
                    </p>

                    {moduleDraft.content_type === "interactive" && (
                      <div className="space-y-2">
                        {interactiveBuilderSteps.map((step, idx) => (
                          <div
                            key={`step-${idx}`}
                            className="flex items-center gap-2"
                          >
                            <input
                              type="text"
                              value={step}
                              onChange={(e) =>
                                setInteractiveBuilderSteps((prev) =>
                                  prev.map((s, i) =>
                                    i === idx ? e.target.value : s,
                                  ),
                                )
                              }
                              placeholder={`Step ${idx + 1}`}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            />
                            {interactiveBuilderSteps.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setInteractiveBuilderSteps((prev) =>
                                    prev.filter((_, i) => i !== idx),
                                  )
                                }
                                className="rounded-lg border border-gray-300 px-2 py-2 text-xs text-gray-600 hover:bg-gray-100"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            setInteractiveBuilderSteps((prev) => [...prev, ""])
                          }
                          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
                        >
                          Add step
                        </button>
                      </div>
                    )}

                    {moduleDraft.content_type === "checklist" && (
                      <div className="space-y-2">
                        {checklistBuilderItems.map((item, idx) => (
                          <div
                            key={`item-${idx}`}
                            className="flex items-center gap-2"
                          >
                            <input
                              type="text"
                              value={item.text}
                              onChange={(e) =>
                                setChecklistBuilderItems((prev) =>
                                  prev.map((it, i) =>
                                    i === idx
                                      ? { ...it, text: e.target.value }
                                      : it,
                                  ),
                                )
                              }
                              placeholder={`Checklist item ${idx + 1}`}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            />
                            <label className="inline-flex items-center gap-1 text-xs text-gray-600">
                              <input
                                type="checkbox"
                                checked={item.critical}
                                onChange={(e) =>
                                  setChecklistBuilderItems((prev) =>
                                    prev.map((it, i) =>
                                      i === idx
                                        ? { ...it, critical: e.target.checked }
                                        : it,
                                    ),
                                  )
                                }
                              />
                              Critical
                            </label>
                            {checklistBuilderItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setChecklistBuilderItems((prev) =>
                                    prev.filter((_, i) => i !== idx),
                                  )
                                }
                                className="rounded-lg border border-gray-300 px-2 py-2 text-xs text-gray-600 hover:bg-gray-100"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            setChecklistBuilderItems((prev) => [
                              ...prev,
                              { text: "", critical: false },
                            ])
                          }
                          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
                        >
                          Add item
                        </button>
                      </div>
                    )}

                    {moduleDraft.content_type === "quiz" && (
                      <div className="space-y-3">
                        {quizBuilderQuestions.map((q, idx) => (
                          <div
                            key={`q-${idx}`}
                            className="rounded-lg border border-gray-200 bg-white p-3 space-y-2"
                          >
                            <input
                              type="text"
                              value={q.text}
                              onChange={(e) =>
                                setQuizBuilderQuestions((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? { ...item, text: e.target.value }
                                      : item,
                                  ),
                                )
                              }
                              placeholder={`Question ${idx + 1}`}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            />
                            <input
                              type="text"
                              value={q.optionsCsv}
                              onChange={(e) =>
                                setQuizBuilderQuestions((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? { ...item, optionsCsv: e.target.value }
                                      : item,
                                  ),
                                )
                              }
                              placeholder="Options (comma separated)"
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            />
                            <input
                              type="text"
                              value={q.correctAnswer}
                              onChange={(e) =>
                                setQuizBuilderQuestions((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? {
                                          ...item,
                                          correctAnswer: e.target.value,
                                        }
                                      : item,
                                  ),
                                )
                              }
                              placeholder="Correct answer (must match one option)"
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            />
                            {quizBuilderQuestions.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setQuizBuilderQuestions((prev) =>
                                    prev.filter((_, i) => i !== idx),
                                  )
                                }
                                className="rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                              >
                                Remove question
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            setQuizBuilderQuestions((prev) => [
                              ...prev,
                              { text: "", optionsCsv: "", correctAnswer: "" },
                            ])
                          }
                          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
                        >
                          Add question
                        </button>
                      </div>
                    )}

                    {(moduleDraft.content_type === "video" ||
                      moduleDraft.content_type === "simulation") && (
                      <input
                        type="url"
                        value={moduleResourceUrl}
                        onChange={(e) => setModuleResourceUrl(e.target.value)}
                        placeholder="Optional resource URL"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap gap-4">
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={moduleDraft.is_published}
                        onChange={(e) =>
                          setModuleDraft((prev) => ({
                            ...prev,
                            is_published: e.target.checked,
                          }))
                        }
                      />
                      Published
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={moduleDraft.is_mandatory}
                        onChange={(e) =>
                          setModuleDraft((prev) => ({
                            ...prev,
                            is_mandatory: e.target.checked,
                          }))
                        }
                      />
                      Mandatory
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={moduleDraft.required_for_onboarding}
                        onChange={(e) =>
                          setModuleDraft((prev) => ({
                            ...prev,
                            required_for_onboarding: e.target.checked,
                          }))
                        }
                      />
                      Required for onboarding
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={createModule}
                      disabled={moduleSaving}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {moduleSaving
                        ? editingModuleId
                          ? "Saving..."
                          : "Creating..."
                        : editingModuleId
                          ? "Save module"
                          : "Create module"}
                    </button>
                    <button
                      onClick={() => {
                        setShowModuleForm(false);
                        setEditingModuleId(null);
                      }}
                      className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

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
                  <div
                    key={mod.id}
                    className="text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 hover:shadow-sm transition-all"
                  >
                    <button
                      onClick={() => setSelectedModule(mod)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[mod.category] ?? "bg-gray-100 text-gray-600"}`}
                          >
                            {mod.category.replace(/_/g, " ")}
                          </span>
                          {canManage && (
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${mod.is_published ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}
                            >
                              {mod.is_published ? "Published" : "Unpublished"}
                            </span>
                          )}
                        </div>
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
                        <span
                          className={DIFFICULTY_COLORS[mod.difficulty_level]}
                        >
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
                    {canManage && (
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          onClick={() => beginEditModule(mod)}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeModule(mod)}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
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
                  onClick={() => {
                    setEditingAssignmentId(null);
                    setShowAssignmentForm((prev) => !prev);
                  }}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4" /> New assignment
                </button>
              </div>
            )}

            {canManage && showAssignmentForm && (
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="mb-4 text-lg font-semibold text-gray-900">
                  {editingAssignmentId ? "Edit assignment" : "Assign learning"}
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
                        disabled={!!editingAssignmentId}
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
                        disabled={!!editingAssignmentId}
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

                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={assignmentDraft.is_mandatory}
                      onChange={(e) =>
                        setAssignmentDraft((prev) => ({
                          ...prev,
                          is_mandatory: e.target.checked,
                        }))
                      }
                    />
                    Mandatory assignment
                  </label>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={
                        editingAssignmentId
                          ? updateAssignment
                          : createAssignment
                      }
                      disabled={assignmentSaving}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {assignmentSaving
                        ? editingAssignmentId
                          ? "Saving..."
                          : "Assigning..."
                        : editingAssignmentId
                          ? "Save changes"
                          : "Assign"}
                    </button>
                    <button
                      onClick={() => {
                        setShowAssignmentForm(false);
                        setEditingAssignmentId(null);
                      }}
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
                        {canManage && (
                          <button
                            onClick={() =>
                              toggleAssignmentCompletions(assignment.id)
                            }
                            className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700"
                          >
                            {expandedAssignmentId === assignment.id
                              ? "Hide completions"
                              : "View completions"}
                          </button>
                        )}

                        {canManage &&
                          expandedAssignmentId === assignment.id && (
                            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                              {completionLoadingId === assignment.id ? (
                                <p className="text-xs text-gray-500">
                                  Loading completions...
                                </p>
                              ) : (assignmentCompletions[assignment.id] ?? [])
                                  .length === 0 ? (
                                <p className="text-xs text-gray-500">
                                  No completions yet.
                                </p>
                              ) : (
                                <ul className="space-y-1">
                                  {(
                                    assignmentCompletions[assignment.id] ?? []
                                  ).map((completion) => (
                                    <li
                                      key={completion.id}
                                      className="text-xs text-gray-700"
                                    >
                                      {(completion.user_name ||
                                        completion.user_id) +
                                        " - " +
                                        new Date(
                                          completion.completed_at,
                                        ).toLocaleString()}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
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
                            onClick={() => beginEditAssignment(assignment)}
                            className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 hover:bg-gray-100"
                            title="Edit assignment"
                          >
                            <Pencil className="h-4 w-4" />
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
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-gray-700">
                      {t("onboardingProgress")}
                    </h3>
                    <input
                      type="text"
                      value={onboardingSearch}
                      onChange={(e) => setOnboardingSearch(e.target.value)}
                      placeholder={t("onboardingSearchPlaceholder")}
                      className="w-full sm:w-72 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="max-h-96 overflow-y-auto pr-1 space-y-3">
                    {filteredNurseStatuses.map(
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
                    {filteredNurseStatuses.length === 0 && (
                      <p className="text-sm text-gray-500 italic">
                        {t("onboardingSearchNoResults")}
                      </p>
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
