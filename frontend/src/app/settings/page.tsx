"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Upload,
  RefreshCw,
  ArrowLeft,
  Copy,
  Check,
  Users,
  Building2,
  Trash2,
  AlertTriangle,
  DoorOpen,
} from "lucide-react";
import { useOrganization } from "../context/OrganizationContext";
import { cleanupOldHandoversAPI } from "../lib/api";
import {
  loadRooms,
  addRoom,
  removeRoom,
  resetRooms,
  DEFAULT_ROOMS,
} from "../lib/roomsConfig";
import {
  loadTeams,
  addTeam,
  removeTeam,
  resetTeams,
  DEFAULT_TEAMS,
} from "../lib/teamsConfig";
import {
  loadStaffingDefaults,
  saveStaffingDefaults,
  DEFAULT_STAFF_REQUIREMENTS,
  DEFAULT_SHIFT_TYPES,
} from "../components/StaffRequirementsEditor";

const DEFAULT_LOGO = "/logo-placeholder.png";

const getSettingsSections = (t: any) =>
  [
    { id: "logo-settings", label: t("logo") },
    { id: "organization-settings", label: t("organization") },
    { id: "staffing-defaults", label: t("staffing") },
    { id: "teams-settings", label: t("teams") },
    { id: "rooms-settings", label: t("rooms") },
    { id: "data-management", label: t("data") },
    { id: "account-info", label: t("account") },
  ] as const;

export default function SettingsPage() {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const {
    currentOrganization,
    currentMembership,
    isAdmin,
    organizations,
    updateOrganizationLogo,
    updateOrganizationWeeklyTargets,
    approveMember,
    rejectMember,
    leaveOrganization,
    getAuthHeaders,
  } = useOrganization();
  const [logoUrl, setLogoUrl] = useState(DEFAULT_LOGO);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | null>(
    null,
  );

  const [copiedCode, setCopiedCode] = useState(false);
  const [teams, setTeams] = useState<string[]>(DEFAULT_TEAMS);
  const [newTeam, setNewTeam] = useState("");
  const [teamsMessage, setTeamsMessage] = useState("");
  const [teamsMessageType, setTeamsMessageType] = useState<
    "success" | "error" | null
  >(null);
  const [rooms, setRooms] = useState<string[]>(DEFAULT_ROOMS);
  const [newRoom, setNewRoom] = useState("");
  const [roomsMessage, setRoomsMessage] = useState("");
  const [roomsMessageType, setRoomsMessageType] = useState<
    "success" | "error" | null
  >(null);
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [editRoomValue, setEditRoomValue] = useState("");
  const [cleanupDays, setCleanupDays] = useState(7);
  const [cleanupMessage, setCleanupMessage] = useState("");
  const [cleanupMessageType, setCleanupMessageType] = useState<
    "success" | "error" | null
  >(null);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [fullTimeBiWeeklyTarget, setFullTimeBiWeeklyTarget] = useState(75);
  const [partTimeBiWeeklyTarget, setPartTimeBiWeeklyTarget] = useState(63.75);
  const [savingWeeklyTargets, setSavingWeeklyTargets] = useState(false);
  const [weeklyTargetsMessage, setWeeklyTargetsMessage] = useState("");
  const [weeklyTargetsMessageType, setWeeklyTargetsMessageType] = useState<
    "success" | "error" | null
  >(null);

  // Staffing defaults
  const [staffingDefaults, setStaffingDefaults] = useState<
    Record<string, number>
  >(() => loadStaffingDefaults());
  const [staffingMessage, setStaffingMessage] = useState("");

  // Pending members state (admin only)
  interface PendingMember {
    id: string;
    user_id: string;
    user_email?: string;
    user_name?: string;
    is_approved: boolean;
    joined_at: string;
  }
  const [pendingMembers, setPendingMembers] = useState<PendingMember[]>([]);
  const [approvedMembers, setApprovedMembers] = useState<PendingMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [transferringAdmin, setTransferringAdmin] = useState(false);

  // Fetch members for approval (admin only)
  useEffect(() => {
    if (!isAdmin || !currentOrganization) return;
    let cancelled = false;

    async function fetchMembers() {
      setLoadingMembers(true);
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"}/organizations/${currentOrganization!.id}/members`,
          { headers },
        );
        if (res.ok) {
          const members: PendingMember[] = await res.json();
          if (!cancelled) {
            setPendingMembers(members.filter((m) => !m.is_approved));
            setApprovedMembers(members.filter((m) => m.is_approved));
          }
        }
      } catch (err) {
        console.error("Failed to fetch members:", err);
      } finally {
        if (!cancelled) setLoadingMembers(false);
      }
    }

    fetchMembers();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, currentOrganization, getAuthHeaders]);

  const handleApproveMember = async (memberId: string) => {
    if (!currentOrganization) return;
    setApprovingId(memberId);
    try {
      await approveMember(currentOrganization.id, memberId);
      setPendingMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (err) {
      console.error("Failed to approve member:", err);
    } finally {
      setApprovingId(null);
    }
  };

  const handleRejectMember = async (memberId: string) => {
    if (!currentOrganization) return;
    setApprovingId(memberId);
    try {
      await rejectMember(currentOrganization.id, memberId);
      setPendingMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (err) {
      console.error("Failed to reject member:", err);
    } finally {
      setApprovingId(null);
    }
  };

  const handleTransferAdmin = async (
    newAdminMemberId: string,
    newAdminName: string,
  ) => {
    if (!currentOrganization) return;
    if (!confirm(t("confirmTransferAdmin", { name: newAdminName }))) return;

    setTransferringAdmin(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"}/organizations/${currentOrganization.id}/members/${newAdminMemberId}/transfer-admin`,
        {
          method: "POST",
          headers,
        },
      );

      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.detail || t("failedTransferAdminError"));
      }

      // Refresh page to update permissions
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : t("failedTransferAdminError"));
    } finally {
      setTransferringAdmin(false);
    }
  };

  // Sync logo from organization context
  useEffect(() => {
    if (currentOrganization?.logo_url) {
      setLogoUrl(currentOrganization.logo_url);
    } else {
      setLogoUrl(DEFAULT_LOGO);
    }
  }, [currentOrganization?.logo_url]);

  useEffect(() => {
    if (currentOrganization) {
      setFullTimeBiWeeklyTarget(
        currentOrganization.full_time_weekly_target ?? 75,
      );
      setPartTimeBiWeeklyTarget(
        currentOrganization.part_time_weekly_target ?? 63.75,
      );
    }
  }, [
    currentOrganization?.id,
    currentOrganization?.full_time_weekly_target,
    currentOrganization?.part_time_weekly_target,
  ]);

  // Load teams from localStorage
  useEffect(() => {
    setTeams(loadTeams());

    const handleTeamsChange = () => {
      setTeams(loadTeams());
    };

    window.addEventListener("teamsConfigChanged", handleTeamsChange);
    return () => {
      window.removeEventListener("teamsConfigChanged", handleTeamsChange);
    };
  }, []);

  const handleAddTeam = () => {
    const trimmed = newTeam.trim();
    if (!trimmed) return;

    if (teams.includes(trimmed)) {
      setTeamsMessage(t("teamExists"));
      setTeamsMessageType("error");
      setTimeout(() => setTeamsMessage(""), 3000);
      return;
    }

    const updatedTeams = addTeam(trimmed);
    setTeams(updatedTeams);
    setNewTeam("");
    setTeamsMessage(t("teamAdded"));
    setTeamsMessageType("success");
    setTimeout(() => setTeamsMessage(""), 3000);
  };

  const handleRemoveTeam = (teamToRemove: string) => {
    const updatedTeams = removeTeam(teamToRemove);
    setTeams(updatedTeams);
    setTeamsMessage(t("teamRemoved"));
    setTeamsMessageType("success");
    setTimeout(() => setTeamsMessage(""), 3000);
  };

  const handleResetTeams = () => {
    const updatedTeams = resetTeams();
    setTeams(updatedTeams);
    setTeamsMessage(t("teamsReset"));
    setTeamsMessageType("success");
    setTimeout(() => setTeamsMessage(""), 3000);
  };

  // Load rooms from localStorage
  useEffect(() => {
    setRooms(loadRooms());
  }, []);

  const handleAddRoom = () => {
    const trimmed = newRoom.trim();
    if (!trimmed) return;

    if (rooms.includes(trimmed)) {
      setRoomsMessage(t("roomExists"));
      setRoomsMessageType("error");
      setTimeout(() => setRoomsMessage(""), 3000);
      return;
    }

    const updatedRooms = addRoom(trimmed);
    setRooms(updatedRooms);
    setNewRoom("");
    setRoomsMessage(t("roomAdded"));
    setRoomsMessageType("success");
    setTimeout(() => setRoomsMessage(""), 3000);
  };

  const handleRemoveRoom = (roomToRemove: string) => {
    const updatedRooms = removeRoom(roomToRemove);
    setRooms(updatedRooms);
    setRoomsMessage(t("roomRemoved"));
    setRoomsMessageType("success");
    setTimeout(() => setRoomsMessage(""), 3000);
  };

  const handleEditRoom = (room: string) => {
    setEditingRoom(room);
    setEditRoomValue(room);
  };

  const handleSaveRoomEdit = () => {
    if (!editingRoom) return;
    const trimmed = editRoomValue.trim();
    if (!trimmed) {
      setRoomsMessage(t("roomNameEmpty"));
      setRoomsMessageType("error");
      setTimeout(() => setRoomsMessage(""), 3000);
      return;
    }
    if (trimmed !== editingRoom && rooms.includes(trimmed)) {
      setRoomsMessage(t("roomExists"));
      setRoomsMessageType("error");
      setTimeout(() => setRoomsMessage(""), 3000);
      return;
    }
    // Update the room
    const updatedRooms = rooms
      .map((r) => (r === editingRoom ? trimmed : r))
      .sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
      );
    setRooms(updatedRooms);
    localStorage.setItem("patient_rooms_config", JSON.stringify(updatedRooms));
    window.dispatchEvent(new CustomEvent("roomsConfigChanged"));
    setEditingRoom(null);
    setEditRoomValue("");
    setRoomsMessage(t("roomUpdated"));
    setRoomsMessageType("success");
    setTimeout(() => setRoomsMessage(""), 3000);
  };

  const handleResetRooms = () => {
    const defaultRooms = resetRooms();
    setRooms(defaultRooms);
    setRoomsMessage(t("roomsReset"));
    setRoomsMessageType("success");
    setTimeout(() => setRoomsMessage(""), 3000);
  };

  const handleCleanupHandovers = async () => {
    setCleaningUp(true);
    setCleanupMessage("");
    setCleanupMessageType(null);
    try {
      const result = await cleanupOldHandoversAPI(cleanupDays);
      setCleanupMessage(result.message);
      setCleanupMessageType("success");
      setShowCleanupConfirm(false);
    } catch (error) {
      setCleanupMessage(
        error instanceof Error ? error.message : t("failedCleanupHandovers"),
      );
      setCleanupMessageType("error");
    } finally {
      setCleaningUp(false);
      setTimeout(() => setCleanupMessage(""), 5000);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setMessage(t("uploadImageFile"));
      setMessageType("error");
      setTimeout(() => setMessage(""), 3000);
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setMessage(t("fileSizeLimit"));
      setMessageType("error");
      setTimeout(() => setMessage(""), 3000);
      return;
    }

    if (!isAdmin) {
      setMessage(t("adminOnlyLogo"));
      setMessageType("error");
      setTimeout(() => setMessage(""), 3000);
      return;
    }

    setUploading(true);
    try {
      // Convert to base64 data URL
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const dataUrl = reader.result as string;
          await updateOrganizationLogo(dataUrl);
          setLogoUrl(dataUrl);
          setMessage(t("logoUpdated"));
          setMessageType("success");
          setTimeout(() => setMessage(""), 5000);
        } catch (error) {
          setMessage(
            error instanceof Error ? error.message : t("failedUploadLogo"),
          );
          setMessageType("error");
          setTimeout(() => setMessage(""), 3000);
        } finally {
          setUploading(false);
        }
      };
      reader.onerror = () => {
        setMessage(t("failedReadFile"));
        setMessageType("error");
        setTimeout(() => setMessage(""), 3000);
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      setMessage(t("failedUploadLogo"));
      setMessageType("error");
      setTimeout(() => setMessage(""), 3000);
      setUploading(false);
    }
  };

  const handleReset = async () => {
    if (!isAdmin) {
      setMessage(t("adminOnlyResetLogo"));
      setMessageType("error");
      setTimeout(() => setMessage(""), 3000);
      return;
    }

    setUploading(true);
    try {
      await updateOrganizationLogo("");
      setLogoUrl(DEFAULT_LOGO);
      setMessage(t("logoReset"));
      setMessageType("success");
      setTimeout(() => setMessage(""), 5000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("failedResetLogo"));
      setMessageType("error");
      setTimeout(() => setMessage(""), 3000);
    } finally {
      setUploading(false);
    }
  };

  const copyInviteCode = async () => {
    if (currentOrganization?.invite_code) {
      await navigator.clipboard.writeText(currentOrganization.invite_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleSaveWeeklyTargets = async () => {
    if (!isAdmin) {
      setWeeklyTargetsMessage(t("adminOnlyTargets"));
      setWeeklyTargetsMessageType("error");
      setTimeout(() => setWeeklyTargetsMessage(""), 3000);
      return;
    }

    if (
      fullTimeBiWeeklyTarget < 0 ||
      fullTimeBiWeeklyTarget > 336 ||
      partTimeBiWeeklyTarget < 0 ||
      partTimeBiWeeklyTarget > 336
    ) {
      setWeeklyTargetsMessage(t("biweeklyTargetsRange"));
      setWeeklyTargetsMessageType("error");
      setTimeout(() => setWeeklyTargetsMessage(""), 3000);
      return;
    }

    setSavingWeeklyTargets(true);
    try {
      await updateOrganizationWeeklyTargets(
        fullTimeBiWeeklyTarget,
        partTimeBiWeeklyTarget,
      );
      setWeeklyTargetsMessage(t("biweeklyTargetsSaved"));
      setWeeklyTargetsMessageType("success");
    } catch (error) {
      setWeeklyTargetsMessage(
        error instanceof Error ? error.message : t("failedSaveBiweeklyTargets"),
      );
      setWeeklyTargetsMessageType("error");
    } finally {
      setSavingWeeklyTargets(false);
      setTimeout(() => setWeeklyTargetsMessage(""), 4000);
    }
  };

  const scrollToSettingsSection = (sectionId: string) => {
    const target = document.getElementById(sectionId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const SETTINGS_SECTIONS = getSettingsSections(t);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="page-frame py-8">
      <div className="page-container">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm font-medium">{t("back")}</span>
            </button>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {t("title")}
            </h1>
            <p className="text-gray-600">{t("customizePreferences")}</p>
          </div>

          <div className="sticky top-20 z-20 mb-6 rounded-lg border border-gray-200 bg-white/90 px-3 py-2 shadow-sm backdrop-blur-sm">
            <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide">
              {SETTINGS_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => scrollToSettingsSection(section.id)}
                  className="whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-blue-50 hover:text-blue-700"
                >
                  {section.label}
                </button>
              ))}
            </div>
          </div>

          {/* Logo Settings Card */}
          <div
            id="logo-settings"
            className="scroll-mt-36 bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6"
          >
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              {t("logoSettings")}
            </h2>

            {/* Current Logo Preview */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                {t("currentLogo")}
              </label>
              <div className="flex items-center gap-4">
                <div className="w-32 h-32 border-2 border-gray-200 rounded-lg flex items-center justify-center bg-gray-50 p-4">
                  <img
                    src={logoUrl}
                    alt={t("currentLogo")}
                    className="max-w-full max-h-full object-contain"
                    onError={(e) => {
                      e.currentTarget.src = "/MCH Logo.png";
                    }}
                  />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-600 mb-2">
                    {t("uploadCustomLogo")}
                  </p>
                  <p className="text-xs text-gray-500">
                    {t("logoRecommendations")}
                  </p>
                </div>
              </div>
            </div>

            {/* Upload Section */}
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="logo-upload"
                  className="flex items-center justify-center w-full px-6 py-4 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <Upload className="w-5 h-5 text-gray-400 group-hover:text-blue-500" />
                    <span className="text-sm font-medium text-gray-600 group-hover:text-blue-600">
                      {uploading ? t("uploading") : t("clickToUpload")}
                    </span>
                  </div>
                  <input
                    id="logo-upload"
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>
              </div>

              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                {t("resetToDefault")}
              </button>
            </div>

            {/* Message Display */}
            {message && (
              <div
                className={`mt-4 p-3 rounded-lg text-sm ${
                  messageType === "success"
                    ? "bg-green-50 text-green-800 border border-green-200"
                    : "bg-red-50 text-red-800 border border-red-200"
                }`}
              >
                {message}
              </div>
            )}
          </div>

          {/* Organization Settings Card - Only show if user has an organization */}
          {currentOrganization && (
            <div
              id="organization-settings"
              className="scroll-mt-36 bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <Building2 className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-semibold text-gray-900">
                  {t("organizationSettings")}
                </h2>
              </div>

              <div className="space-y-4">
                {/* Organization Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">
                    {t("organizationName")}
                  </label>
                  <p className="text-gray-900 font-medium">
                    {currentOrganization.name}
                  </p>
                </div>

                {/* Your Role */}
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">
                    {t("yourRole")}
                  </label>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                      currentMembership?.role === "admin"
                        ? "bg-purple-100 text-purple-800"
                        : currentMembership?.role === "manager"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-green-100 text-green-800"
                    }`}
                  >
                    {currentMembership?.role || t("member")}
                  </span>
                </div>

                {/* Weekly Hour Defaults - Admin Only */}
                {isAdmin && (
                  <div className="pt-4 border-t border-gray-200">
                    <label className="block text-sm font-medium text-gray-600 mb-2">
                      {t("biweeklyHourDefaults")}
                    </label>
                    <p className="text-xs text-gray-500 mb-3">
                      {t("biweeklyDefaultsDesc")}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          {t("fullTimeTarget")}
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={168}
                          step={0.5}
                          value={fullTimeBiWeeklyTarget}
                          onChange={(e) =>
                            setFullTimeBiWeeklyTarget(
                              parseFloat(e.target.value) || 0,
                            )
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          {t("partTimeTarget")}
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={336}
                          step={0.5}
                          value={partTimeBiWeeklyTarget}
                          onChange={(e) =>
                            setPartTimeBiWeeklyTarget(
                              parseFloat(e.target.value) || 0,
                            )
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </div>
                    <button
                      onClick={handleSaveWeeklyTargets}
                      disabled={savingWeeklyTargets}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {savingWeeklyTargets
                        ? t("saving")
                        : t("saveBiweeklyTargets")}
                    </button>

                    {weeklyTargetsMessage && (
                      <div
                        className={`mt-3 p-2 rounded-lg text-sm ${
                          weeklyTargetsMessageType === "success"
                            ? "bg-green-50 text-green-800 border border-green-200"
                            : "bg-red-50 text-red-800 border border-red-200"
                        }`}
                      >
                        {weeklyTargetsMessage}
                      </div>
                    )}
                  </div>
                )}

                {/* Invite Code - Only show to admins */}
                {isAdmin && currentOrganization.invite_code && (
                  <div className="pt-4 border-t border-gray-200">
                    <label className="block text-sm font-medium text-gray-600 mb-2">
                      <Users className="w-4 h-4 inline mr-1" />
                      {t("teamInviteCode")}
                    </label>
                    <p className="text-xs text-gray-500 mb-3">
                      {t("shareInviteCode")}
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-lg px-4 py-3 font-mono text-lg tracking-widest text-center font-semibold text-gray-800">
                        {currentOrganization.invite_code}
                      </div>
                      <button
                        onClick={copyInviteCode}
                        className={`flex items-center gap-2 px-4 py-3 rounded-lg font-medium transition-all ${
                          copiedCode
                            ? "bg-green-100 text-green-700"
                            : "bg-blue-600 text-white hover:bg-blue-700"
                        }`}
                      >
                        {copiedCode ? (
                          <>
                            <Check className="w-4 h-4" />
                            {t("copied")}
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            {t("copy")}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Pending Member Approvals - Admin only */}
                {isAdmin && pendingMembers.length > 0 && (
                  <div className="pt-4 border-t border-gray-200">
                    <label className="block text-sm font-medium text-gray-600 mb-2">
                      <Users className="w-4 h-4 inline mr-1" />
                      {t("pendingApprovalsCount")}
                      <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-amber-500 rounded-full">
                        {pendingMembers.length}
                      </span>
                    </label>
                    <p className="text-xs text-gray-500 mb-3">
                      {t("usedInviteCode")}
                    </p>
                    <div className="space-y-2">
                      {pendingMembers.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-3"
                        >
                          <div>
                            <p className="font-medium text-gray-900 text-sm">
                              {member.user_name ||
                                member.user_email ||
                                `User ${member.user_id.substring(0, 8)}...`}
                            </p>
                            <p className="text-xs text-gray-500">
                              {member.user_email || `ID: ${member.user_id}`} ·
                              Requested{" "}
                              {new Date(member.joined_at).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleApproveMember(member.id)}
                              disabled={approvingId === member.id}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                            >
                              {approvingId === member.id
                                ? t("approving")
                                : t("approveMember")}
                            </button>
                            <button
                              onClick={() => handleRejectMember(member.id)}
                              disabled={approvingId === member.id}
                              className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
                            >
                              {t("rejectMember")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {isAdmin && loadingMembers && (
                  <div className="pt-4 border-t border-gray-200">
                    <p className="text-sm text-gray-400">
                      {t("checkingPendingMembers")}
                    </p>
                  </div>
                )}

                {/* Transfer Admin Role - Admin only */}
                {isAdmin && approvedMembers.length > 0 && (
                  <div className="pt-4 border-t border-gray-200">
                    <label className="block text-sm font-medium text-gray-600 mb-2">
                      <Users className="w-4 h-4 inline mr-1" />
                      {t("transferAdminRoleTitle")}
                    </label>
                    <p className="text-xs text-gray-500 mb-3">
                      {t("transferAdminRoleDesc")}
                    </p>
                    <div className="space-y-2">
                      {approvedMembers
                        .filter((m) => m.id !== currentMembership?.id)
                        .map((member) => (
                          <div
                            key={member.id}
                            className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-4 py-3"
                          >
                            <div>
                              <p className="font-medium text-gray-900 text-sm">
                                {member.user_name ||
                                  member.user_email ||
                                  `User ${member.user_id.substring(0, 8)}...`}
                              </p>
                              <p className="text-xs text-gray-500">
                                {member.user_email || `ID: ${member.user_id}`}
                              </p>
                            </div>
                            <button
                              onClick={() =>
                                handleTransferAdmin(
                                  member.id,
                                  member.user_name ||
                                    member.user_email ||
                                    `User ${member.user_id.substring(0, 8)}...`,
                                )
                              }
                              disabled={transferringAdmin}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
                            >
                              {transferringAdmin
                                ? t("transferringAdmin")
                                : t("transferAdminBtn")}
                            </button>
                          </div>
                        ))}
                      {approvedMembers.filter(
                        (m) => m.id !== currentMembership?.id,
                      ).length === 0 && (
                        <p className="text-sm text-gray-500 italic">
                          {t("noOtherApprovedMembers")}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Organizations count */}
                {organizations.length > 1 && (
                  <div className="pt-4 border-t border-gray-200">
                    <p className="text-sm text-gray-600">
                      You are a member of{" "}
                      <span className="font-medium">
                        {organizations.length}
                      </span>{" "}
                      organization{organizations.length > 1 ? "s" : ""}.
                    </p>
                  </div>
                )}

                {/* Leave Organization */}
                <div className="pt-4 border-t border-gray-200">
                  <label className="block text-sm font-medium text-red-600 mb-1">
                    <DoorOpen className="w-4 h-4 inline mr-1" />
                    {t("leaveOrganizationTitle")}
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    {t("leaveOrganizationDescription")}{" "}
                    <span className="font-medium">
                      {currentOrganization.name}
                    </span>
                    . {t("leaveOrganizationNote")}
                    {isAdmin && " " + t("leaveOrganizationAdminNote")}
                  </p>
                  <button
                    onClick={async () => {
                      if (
                        !confirm(
                          t("confirmLeave", { name: currentOrganization.name }),
                        )
                      )
                        return;
                      try {
                        await leaveOrganization(currentOrganization.id);
                        router.push("/dashboard");
                      } catch (err: any) {
                        alert(err.message || t("failedToLeave"));
                      }
                    }}
                    className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    <DoorOpen className="w-4 h-4 inline mr-1" />
                    {t("leaveOrganizationTitle")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Staffing Defaults Card */}
          <div
            id="staffing-defaults"
            className="scroll-mt-36 bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <Users className="w-6 h-6 text-emerald-600" />
              <h2 className="text-xl font-semibold text-gray-900">
                {t("staffingRequirementsDefaultsTitle")}
              </h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              {t("staffingRequirementsDefaultsDesc")}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              {DEFAULT_SHIFT_TYPES.map((shift) => (
                <div key={shift}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {shift}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step={1}
                    value={staffingDefaults[shift] ?? 0}
                    onChange={(e) =>
                      setStaffingDefaults((prev) => ({
                        ...prev,
                        [shift]: parseInt(e.target.value) || 0,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  saveStaffingDefaults(staffingDefaults);
                  setStaffingMessage(t("staffingDefaultsSaved"));
                  setTimeout(() => setStaffingMessage(""), 3000);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
              >
                {t("saveDefaults")}
              </button>
              <button
                onClick={() => {
                  setStaffingDefaults({ ...DEFAULT_STAFF_REQUIREMENTS });
                  saveStaffingDefaults(DEFAULT_STAFF_REQUIREMENTS);
                  setStaffingMessage(t("resetToFactory"));
                  setTimeout(() => setStaffingMessage(""), 3000);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                {t("reset")}
              </button>
            </div>
            {staffingMessage && (
              <div className="mt-3 p-2 rounded-lg text-sm bg-green-50 text-green-800 border border-green-200">
                {staffingMessage}
              </div>
            )}
          </div>

          {/* Teams Management Card */}
          <div
            id="teams-settings"
            className="scroll-mt-36 bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <Users className="w-6 h-6 text-blue-600" />
              <h2 className="text-xl font-semibold text-gray-900">
                {t("teamsTitle")}
              </h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">{t("manageTeams")}</p>

            {/* Current Teams */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t("currentTeams")}
              </label>
              <div className="flex flex-wrap gap-2">
                {teams.map((team) => (
                  <div
                    key={team}
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg border border-blue-200"
                  >
                    <span className="text-sm font-medium">{team}</span>
                    <button
                      onClick={() => handleRemoveTeam(team)}
                      className="text-blue-600 hover:text-red-600 transition-colors"
                      title={t("removeTeam")}
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Add New Team */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t("addNewTeam")}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTeam}
                  onChange={(e) => setNewTeam(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTeam();
                    }
                  }}
                  placeholder={t("enterTeamName")}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <button
                  onClick={handleAddTeam}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  {tCommon("add")}
                </button>
              </div>
            </div>

            {/* Reset Button */}
            <button
              onClick={handleResetTeams}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              {t("resetToDefaultTeams")}
            </button>

            {/* Teams Message */}
            {teamsMessage && (
              <div
                className={`mt-4 p-3 rounded-lg text-sm ${
                  teamsMessageType === "success"
                    ? "bg-green-50 text-green-800 border border-green-200"
                    : "bg-red-50 text-red-800 border border-red-200"
                }`}
              >
                {teamsMessage}
              </div>
            )}
          </div>

          {/* Rooms Management Card (Admin Only) */}
          {isAdmin && (
            <div
              id="rooms-settings"
              className="scroll-mt-36 bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <DoorOpen className="w-6 h-6 text-green-600" />
                <h2 className="text-xl font-semibold text-gray-900">
                  {t("roomsTitle")}
                </h2>
                <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                  {t("admin")}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-4">{t("manageRooms")}</p>

              {/* Current Rooms */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t("currentRooms")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {rooms.map((room) => (
                    <div
                      key={room}
                      className="flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg border border-green-200"
                    >
                      {editingRoom === room ? (
                        <>
                          <input
                            type="text"
                            value={editRoomValue}
                            onChange={(e) => setEditRoomValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleSaveRoomEdit();
                              } else if (e.key === "Escape") {
                                setEditingRoom(null);
                                setEditRoomValue("");
                              }
                            }}
                            className="w-20 px-2 py-0.5 text-sm border border-green-300 rounded focus:ring-1 focus:ring-green-500"
                            autoFocus
                          />
                          <button
                            onClick={handleSaveRoomEdit}
                            className="text-green-600 hover:text-green-800 transition-colors"
                            title={t("save")}
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingRoom(null);
                              setEditRoomValue("");
                            }}
                            className="text-gray-500 hover:text-gray-700 transition-colors"
                            title={t("cancel")}
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm font-medium">{room}</span>
                          <button
                            onClick={() => handleEditRoom(room)}
                            className="text-green-600 hover:text-blue-600 transition-colors"
                            title={t("editRoom")}
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                              />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleRemoveRoom(room)}
                            className="text-green-600 hover:text-red-600 transition-colors"
                            title={t("removeRoom")}
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Add New Room */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t("addNewRoom")}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newRoom}
                    onChange={(e) => setNewRoom(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddRoom();
                      }
                    }}
                    placeholder={t("enterRoomNumber")}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                  <button
                    onClick={handleAddRoom}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                  >
                    {tCommon("add")}
                  </button>
                </div>
              </div>

              {/* Reset Button */}
              <button
                onClick={handleResetRooms}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                {t("resetToDefaultRooms")}
              </button>

              {/* Rooms Message */}
              {roomsMessage && (
                <div
                  className={`mt-4 p-3 rounded-lg text-sm ${
                    roomsMessageType === "success"
                      ? "bg-green-50 text-green-800 border border-green-200"
                      : "bg-red-50 text-red-800 border border-red-200"
                  }`}
                >
                  {roomsMessage}
                </div>
              )}
            </div>
          )}

          {/* Data Management Card */}
          <div
            id="data-management"
            className="scroll-mt-36 bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <Trash2 className="w-6 h-6 text-red-600" />
              <h2 className="text-xl font-semibold text-gray-900">
                {t("dataManagement")}
              </h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              {t("cleanupOldHandoffs")}
            </p>

            {/* Cleanup Days Selector */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t("keepHandoffsFromLast")}
              </label>
              <div className="flex items-center gap-3">
                <select
                  value={cleanupDays}
                  onChange={(e) => setCleanupDays(Number(e.target.value))}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value={7}>{`7 ${t("days")}`}</option>
                  <option value={14}>{`14 ${t("days")}`}</option>
                  <option value={30}>{`30 ${t("days")}`}</option>
                  <option value={60}>{`60 ${t("days")}`}</option>
                  <option value={90}>{`90 ${t("days")}`}</option>
                  <option value={180}>{`180 ${t("days")}`}</option>
                  <option value={365}>{`365 ${t("days")}`}</option>
                </select>
                <span className="text-sm text-gray-500">
                  {t("olderHandoffsDeleted")}
                </span>
              </div>
            </div>

            {/* Cleanup Button */}
            {!showCleanupConfirm ? (
              <button
                onClick={() => setShowCleanupConfirm(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors border border-red-200"
              >
                <Trash2 className="w-4 h-4" />
                {t("cleanUpOldHandoffs")}
              </button>
            ) : (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-3 mb-4">
                  <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-800">
                      {t("confirmDeleteHandoffs")}
                    </p>
                    <p className="text-sm text-red-700 mt-1">
                      {t("deleteHandoffsWarning", { days: cleanupDays })}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCleanupHandovers}
                    disabled={cleaningUp}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    {cleaningUp ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        {t("deleting")}
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        {t("yesDeleteHandoffs")}
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setShowCleanupConfirm(false)}
                    disabled={cleaningUp}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white rounded-lg hover:bg-gray-100 transition-colors border border-gray-300 disabled:opacity-50"
                  >
                    {tCommon("cancel")}
                  </button>
                </div>
              </div>
            )}

            {/* Cleanup Message */}
            {cleanupMessage && (
              <div
                className={`mt-4 p-3 rounded-lg text-sm ${
                  cleanupMessageType === "success"
                    ? "bg-green-50 text-green-800 border border-green-200"
                    : "bg-red-50 text-red-800 border border-red-200"
                }`}
              >
                {cleanupMessage}
              </div>
            )}
          </div>

          {/* User Info Card */}
          <div
            id="account-info"
            className="scroll-mt-36 bg-white rounded-xl shadow-sm border border-gray-200 p-6"
          >
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              {t("accountInformation")}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-600">
                  {t("email")}
                </label>
                <p className="text-gray-900">
                  {user?.primaryEmailAddress?.emailAddress || "N/A"}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600">
                  {t("name")}
                </label>
                <p className="text-gray-900">{user?.fullName || "N/A"}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
