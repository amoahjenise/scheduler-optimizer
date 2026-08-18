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
import RolePermissionsSection from "./RolePermissionsSection";
import { cleanupOldHandoversAPI, listNursesAPI, type Nurse } from "../lib/api";
import { getApiBase } from "../lib/runtimeApiBase";
import { DEFAULT_ROOMS } from "../lib/roomsConfig";
import { DEFAULT_TEAMS } from "../lib/teamsConfig";
import { DEFAULT_STAFFING_TEAMS } from "../lib/staffingTeamsConfig";
import {
  fetchAndCacheOrganizationConfig,
  updateAndCacheOrganizationConfig,
} from "../lib/orgConfig";
import {
  loadStaffingDefaults,
  saveStaffingDefaults,
  DEFAULT_STAFF_REQUIREMENTS,
  DEFAULT_SHIFT_TYPES,
} from "../components/StaffRequirementsEditor";

const DEFAULT_LOGO = "/logo-placeholder.png";
const CLEANUP_DAYS_STORAGE_KEY = "chronofy_cleanup_days_to_keep";

type SettingsTranslator = (
  key: string,
  values?: Record<string, unknown>,
) => string;

interface AssistantManagerMappingOption {
  user_id: string;
  name: string;
  employee_id?: string | null;
  nurse_id?: string;
}

const getSettingsSections = (t: SettingsTranslator, isAdmin: boolean) =>
  [
    ...(isAdmin ? [{ id: "logo-settings", label: t("logo") }] : []),
    { id: "organization-settings", label: t("organization") },
    ...(isAdmin
      ? [{ id: "assignment-print-layout-settings", label: t("printLayoutMenu") }]
      : []),
    ...(isAdmin ? [{ id: "staffing-defaults", label: t("staffing") }] : []),
    ...(isAdmin
      ? [{ id: "staffing-teams-settings", label: t("staffingTeams") }]
      : []),
    ...(isAdmin
      ? [
          {
            id: "assistant-manager-mapping-settings",
            label: t("assistantManagerTeamMapping"),
          },
        ]
      : []),
    ...(isAdmin ? [{ id: "services-settings", label: t("services") }] : []),
    ...(isAdmin ? [{ id: "rooms-settings", label: t("rooms") }] : []),
    ...(isAdmin ? [{ id: "role-permissions", label: t("rolesPermissions") }] : []),
    ...(isAdmin ? [{ id: "data-management", label: t("data") }] : []),
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
    updateWeekendTeamRotationEnabled,
    updatePrintShiftLayoutMode,
    approveMember,
    rejectMember,
    leaveOrganization,
    refreshOrganizations,
    getAuthHeaders,
    isLoading: orgLoading,
  } = useOrganization();
  const orgId = currentOrganization?.id;
  const [logoUrl, setLogoUrl] = useState(DEFAULT_LOGO);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | null>(
    null,
  );

  const [copiedCode, setCopiedCode] = useState(false);
  const [teams, setTeams] = useState<string[]>([]);
  const [newTeam, setNewTeam] = useState("");
  const [teamsMessage, setTeamsMessage] = useState("");
  const [teamsMessageType, setTeamsMessageType] = useState<
    "success" | "error" | null
  >(null);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [staffingTeams, setStaffingTeams] = useState<string[]>([]);
  const [newStaffingTeam, setNewStaffingTeam] = useState("");
  const [staffingTeamsMessage, setStaffingTeamsMessage] = useState("");
  const [staffingTeamsMessageType, setStaffingTeamsMessageType] = useState<
    "success" | "error" | null
  >(null);
  const [staffingTeamsLoading, setStaffingTeamsLoading] = useState(false);
  const [assistantManagers, setAssistantManagers] = useState<
    AssistantManagerMappingOption[]
  >([]);
  const [assistantManagerTeamMap, setAssistantManagerTeamMap] = useState<
    Record<string, string>
  >({});
  const [assistantManagerMapSaving, setAssistantManagerMapSaving] =
    useState(false);
  const [assistantManagerMapMessage, setAssistantManagerMapMessage] =
    useState("");
  const [assistantManagerMapMessageType, setAssistantManagerMapMessageType] =
    useState<"success" | "error" | null>(null);
  const [rooms, setRooms] = useState<string[]>([]);
  const [newRoom, setNewRoom] = useState("");
  const [roomsMessage, setRoomsMessage] = useState("");
  const [roomsMessageType, setRoomsMessageType] = useState<
    "success" | "error" | null
  >(null);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [editRoomValue, setEditRoomValue] = useState("");
  const [cleanupDays, setCleanupDays] = useState(() => {
    if (typeof window === "undefined") return 7;
    const stored = Number(localStorage.getItem(CLEANUP_DAYS_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= 1 ? stored : 7;
  });
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
  const [savingWeekendRotation, setSavingWeekendRotation] = useState(false);
  const [savingPrintLayoutMode, setSavingPrintLayoutMode] = useState(false);
  const [printLayoutMessage, setPrintLayoutMessage] = useState("");
  const [printLayoutMessageType, setPrintLayoutMessageType] = useState<
    "success" | "error" | null
  >(null);
  const orgFullTimeWeeklyTarget = currentOrganization?.full_time_weekly_target;
  const orgPartTimeWeeklyTarget = currentOrganization?.part_time_weekly_target;

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
    role?: string;
    is_approved: boolean;
    joined_at: string;
  }
  const [pendingMembers, setPendingMembers] = useState<PendingMember[]>([]);
  const [approvedMembers, setApprovedMembers] = useState<PendingMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [transferringAdmin, setTransferringAdmin] = useState(false);
  const [transferCandidateId, setTransferCandidateId] = useState<string | null>(
    null,
  );
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  const [deletingOrganization, setDeletingOrganization] = useState(false);
  const [showDeleteOrgConfirm, setShowDeleteOrgConfirm] = useState(false);
  const [deleteOrgConfirmName, setDeleteOrgConfirmName] = useState("");

  // Fetch members for approval (admin only)
  useEffect(() => {
    if (!isAdmin || !currentOrganization) return;
    let cancelled = false;

    async function fetchMembers() {
      setLoadingMembers(true);
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(
          `${getApiBase()}/organizations/${currentOrganization!.id}/members`,
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

    setTransferringAdmin(true);
    setTransferMessage(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${getApiBase()}/organizations/${currentOrganization.id}/members/${newAdminMemberId}/transfer-admin`,
        {
          method: "POST",
          headers,
        },
      );

      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.detail || t("failedTransferAdminError"));
      }

      // Reflect the new ownership immediately: the caller is no longer admin.
      setTransferCandidateId(null);
      setTransferMessage(
        `${newAdminName} is now the admin. Your role has been changed to nurse.`,
      );

      const membersRes = await fetch(
        `${getApiBase()}/organizations/${currentOrganization.id}/members`,
        { headers },
      );
      if (membersRes.ok) {
        const members: PendingMember[] = await membersRes.json();
        setPendingMembers(members.filter((m) => !m.is_approved));
        setApprovedMembers(members.filter((m) => m.is_approved));
      }

      await refreshOrganizations(currentOrganization.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : t("failedTransferAdminError"));
    } finally {
      setTransferringAdmin(false);
    }
  };

  const handleDeleteOrganization = async () => {
    if (!currentOrganization || !isAdmin) return;

    if (deleteOrgConfirmName.trim() !== currentOrganization.name) {
      alert("Organization name did not match. Deletion cancelled.");
      return;
    }

    setDeletingOrganization(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${getApiBase()}/organizations/${currentOrganization.id}`,
        {
          method: "DELETE",
          headers,
        },
      );

      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.detail || "Failed to delete organization");
      }

      await refreshOrganizations();
      setShowDeleteOrgConfirm(false);
      setDeleteOrgConfirmName("");
      alert("Organization deleted.");
      router.push("/dashboard");
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Failed to delete organization",
      );
    } finally {
      setDeletingOrganization(false);
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
    if (orgId) {
      setFullTimeBiWeeklyTarget(orgFullTimeWeeklyTarget ?? 75);
      setPartTimeBiWeeklyTarget(orgPartTimeWeeklyTarget ?? 63.75);
    }
  }, [orgId, orgFullTimeWeeklyTarget, orgPartTimeWeeklyTarget]);

  // Load teams/rooms from backend org config
  useEffect(() => {
    if (!orgId) {
      setTeams([]);
      setRooms([]);
      return;
    }

    let cancelled = false;

    async function loadOrgConfig() {
      setTeamsLoading(true);
      setStaffingTeamsLoading(true);
      setRoomsLoading(true);
      try {
        const headers = await getAuthHeaders();
        const config = await fetchAndCacheOrganizationConfig(orgId, headers);
        if (!cancelled) {
          setTeams(config.team_options);
          setStaffingTeams(config.staffing_team_options);
          setAssistantManagerTeamMap(config.assistant_manager_team_map || {});
          setRooms(config.room_options);
        }
      } catch (err) {
        console.error("Failed to load org config options:", err);
        if (!cancelled) {
          setTeams([]);
          setStaffingTeams([]);
          setRooms([]);
          setTeamsMessage("Unable to load team settings from server");
          setTeamsMessageType("error");
          setStaffingTeamsMessage("Unable to load staffing team settings from server");
          setStaffingTeamsMessageType("error");
          setRoomsMessage("Unable to load room settings from server");
          setRoomsMessageType("error");
        }
      } finally {
        if (!cancelled) {
          setTeamsLoading(false);
          setStaffingTeamsLoading(false);
          setRoomsLoading(false);
        }
      }
    }

    loadOrgConfig();
    return () => {
      cancelled = true;
    };
  }, [orgId, getAuthHeaders]);

  const persistTeams = async (nextTeams: string[]) => {
    if (!orgId) return;
    setTeamsLoading(true);
    try {
      const headers = await getAuthHeaders();
      const config = await updateAndCacheOrganizationConfig(
        orgId,
        { team_options: nextTeams },
        headers,
      );
      setTeams(config.team_options);
    } finally {
      setTeamsLoading(false);
    }
  };

  const persistStaffingTeams = async (nextStaffingTeams: string[]) => {
    if (!orgId) return;
    setStaffingTeamsLoading(true);
    try {
      const headers = await getAuthHeaders();
      const config = await updateAndCacheOrganizationConfig(
        orgId,
        { staffing_team_options: nextStaffingTeams },
        headers,
      );
      setStaffingTeams(config.staffing_team_options);
    } finally {
      setStaffingTeamsLoading(false);
    }
  };

  const persistAssistantManagerTeamMap = async (
    nextMap: Record<string, string>,
  ) => {
    if (!orgId) return;
    setAssistantManagerMapSaving(true);
    try {
      const headers = await getAuthHeaders();
      const config = await updateAndCacheOrganizationConfig(
        orgId,
        { assistant_manager_team_map: nextMap },
        headers,
      );
      setAssistantManagerTeamMap(config.assistant_manager_team_map || {});
    } finally {
      setAssistantManagerMapSaving(false);
    }
  };

  const persistRooms = async (nextRooms: string[]) => {
    if (!orgId) return;
    setRoomsLoading(true);
    try {
      const headers = await getAuthHeaders();
      const config = await updateAndCacheOrganizationConfig(
        orgId,
        { room_options: nextRooms },
        headers,
      );
      setRooms(config.room_options);
    } finally {
      setRoomsLoading(false);
    }
  };

  const handleAddTeam = async () => {
    const trimmed = newTeam.trim();
    if (!trimmed) return;

    if (teams.includes(trimmed)) {
      setTeamsMessage(t("teamExists"));
      setTeamsMessageType("error");
      setTimeout(() => setTeamsMessage(""), 3000);
      return;
    }

    try {
      await persistTeams([...teams, trimmed]);
      setNewTeam("");
      setTeamsMessage(t("teamAdded"));
      setTeamsMessageType("success");
      setTimeout(() => setTeamsMessage(""), 3000);
    } catch (err) {
      setTeamsMessage(
        err instanceof Error ? err.message : "Failed to save team settings",
      );
      setTeamsMessageType("error");
      setTimeout(() => setTeamsMessage(""), 3000);
    }
  };

  const handleRemoveTeam = async (teamToRemove: string) => {
    try {
      await persistTeams(teams.filter((team) => team !== teamToRemove));
      setTeamsMessage(t("teamRemoved"));
      setTeamsMessageType("success");
      setTimeout(() => setTeamsMessage(""), 3000);
    } catch (err) {
      setTeamsMessage(
        err instanceof Error ? err.message : "Failed to save team settings",
      );
      setTeamsMessageType("error");
      setTimeout(() => setTeamsMessage(""), 3000);
    }
  };

  const handleResetTeams = async () => {
    try {
      await persistTeams(DEFAULT_TEAMS);
      setTeamsMessage(t("teamsReset"));
      setTeamsMessageType("success");
      setTimeout(() => setTeamsMessage(""), 3000);
    } catch (err) {
      setTeamsMessage(
        err instanceof Error ? err.message : "Failed to save team settings",
      );
      setTeamsMessageType("error");
      setTimeout(() => setTeamsMessage(""), 3000);
    }
  };

  const handleAddStaffingTeam = async () => {
    const trimmed = newStaffingTeam.trim();
    if (!trimmed) return;

    if (staffingTeams.includes(trimmed)) {
      setStaffingTeamsMessage(t("staffingTeamExists"));
      setStaffingTeamsMessageType("error");
      setTimeout(() => setStaffingTeamsMessage(""), 3000);
      return;
    }

    try {
      await persistStaffingTeams([...staffingTeams, trimmed]);
      setNewStaffingTeam("");
      setStaffingTeamsMessage(t("staffingTeamAdded"));
      setStaffingTeamsMessageType("success");
      setTimeout(() => setStaffingTeamsMessage(""), 3000);
    } catch (err) {
      setStaffingTeamsMessage(
        err instanceof Error
          ? err.message
          : "Failed to save staffing team settings",
      );
      setStaffingTeamsMessageType("error");
      setTimeout(() => setStaffingTeamsMessage(""), 3000);
    }
  };

  const handleRemoveStaffingTeam = async (teamToRemove: string) => {
    try {
      await persistStaffingTeams(
        staffingTeams.filter((team) => team !== teamToRemove),
      );
      setStaffingTeamsMessage(t("staffingTeamRemoved"));
      setStaffingTeamsMessageType("success");
      setTimeout(() => setStaffingTeamsMessage(""), 3000);
    } catch (err) {
      setStaffingTeamsMessage(
        err instanceof Error
          ? err.message
          : "Failed to save staffing team settings",
      );
      setStaffingTeamsMessageType("error");
      setTimeout(() => setStaffingTeamsMessage(""), 3000);
    }
  };

  const handleResetStaffingTeams = async () => {
    try {
      await persistStaffingTeams(DEFAULT_STAFFING_TEAMS);
      setStaffingTeamsMessage(t("staffingTeamsReset"));
      setStaffingTeamsMessageType("success");
      setTimeout(() => setStaffingTeamsMessage(""), 3000);
    } catch (err) {
      setStaffingTeamsMessage(
        err instanceof Error
          ? err.message
          : "Failed to save staffing team settings",
      );
      setStaffingTeamsMessageType("error");
      setTimeout(() => setStaffingTeamsMessage(""), 3000);
    }
  };

  const handleAssistantManagerTeamChange = async (
    assistantManagerUserId: string,
    staffingTeam: string,
    legacyNurseId?: string,
  ) => {
    try {
      const nextMap = { ...assistantManagerTeamMap };
      if (legacyNurseId && legacyNurseId !== assistantManagerUserId) {
        delete nextMap[legacyNurseId];
      }
      if (staffingTeam) {
        nextMap[assistantManagerUserId] = staffingTeam;
      } else {
        delete nextMap[assistantManagerUserId];
      }
      await persistAssistantManagerTeamMap(nextMap);
      setAssistantManagerMapMessage(t("assistantManagerMappingSaved"));
      setAssistantManagerMapMessageType("success");
      setTimeout(() => setAssistantManagerMapMessage(""), 3000);
    } catch (err) {
      setAssistantManagerMapMessage(
        err instanceof Error
          ? err.message
          : t("assistantManagerMappingSaveFailed"),
      );
      setAssistantManagerMapMessageType("error");
      setTimeout(() => setAssistantManagerMapMessage(""), 3000);
    }
  };

  useEffect(() => {
    if (!user?.id || orgLoading || !currentOrganization || !isAdmin) {
      setAssistantManagers([]);
      return;
    }

    let cancelled = false;

    async function loadAssistantManagers() {
      const roleBasedManagers = approvedMembers.filter(
        (member) => member.role === "assistant_manager" && member.is_approved,
      );

      if (roleBasedManagers.length === 0) {
        if (!cancelled) {
          setAssistantManagers([]);
        }
        return;
      }

      try {
        const authHeaders = await getAuthHeaders();
        const nursesResult = await listNursesAPI(
          user.id,
          1,
          500,
          undefined,
          authHeaders,
        );
        if (!cancelled) {
          const nursesByUserId = new Map<string, Nurse>();
          for (const nurse of nursesResult.nurses || []) {
            if (nurse.user_id) {
              nursesByUserId.set(nurse.user_id, nurse);
            }
          }

          const options: AssistantManagerMappingOption[] = roleBasedManagers.map(
            (member) => {
              const linkedNurse = nursesByUserId.get(member.user_id);
              return {
                user_id: member.user_id,
                name:
                  member.user_name ||
                  linkedNurse?.name ||
                  member.user_email ||
                  member.user_id,
                employee_id: linkedNurse?.employee_id || undefined,
                nurse_id: linkedNurse?.id,
              };
            },
          );

          setAssistantManagers(options);
        }
      } catch (error) {
        if (!cancelled) {
          const fallback = roleBasedManagers.map((member) => ({
            user_id: member.user_id,
            name: member.user_name || member.user_email || member.user_id,
            employee_id: undefined,
            nurse_id: undefined,
          }));
          setAssistantManagers(fallback);
        }
      }
    }

    loadAssistantManagers();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user?.id,
    orgLoading,
    currentOrganization?.id,
    isAdmin,
    approvedMembers,
  ]);

  const handleAddRoom = async () => {
    const trimmed = newRoom.trim();
    if (!trimmed) return;

    if (rooms.includes(trimmed)) {
      setRoomsMessage(t("roomExists"));
      setRoomsMessageType("error");
      setTimeout(() => setRoomsMessage(""), 3000);
      return;
    }

    try {
      const next = [...rooms, trimmed].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
      );
      await persistRooms(next);
      setNewRoom("");
      setRoomsMessage(t("roomAdded"));
      setRoomsMessageType("success");
      setTimeout(() => setRoomsMessage(""), 3000);
    } catch (err) {
      setRoomsMessage(
        err instanceof Error ? err.message : "Failed to save room settings",
      );
      setRoomsMessageType("error");
      setTimeout(() => setRoomsMessage(""), 3000);
    }
  };

  const handleRemoveRoom = async (roomToRemove: string) => {
    try {
      await persistRooms(rooms.filter((room) => room !== roomToRemove));
      setRoomsMessage(t("roomRemoved"));
      setRoomsMessageType("success");
      setTimeout(() => setRoomsMessage(""), 3000);
    } catch (err) {
      setRoomsMessage(
        err instanceof Error ? err.message : "Failed to save room settings",
      );
      setRoomsMessageType("error");
      setTimeout(() => setRoomsMessage(""), 3000);
    }
  };

  const handleEditRoom = (room: string) => {
    setEditingRoom(room);
    setEditRoomValue(room);
  };

  const handleSaveRoomEdit = async () => {
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
    try {
      await persistRooms(updatedRooms);
      setEditingRoom(null);
      setEditRoomValue("");
      setRoomsMessage(t("roomUpdated"));
      setRoomsMessageType("success");
      setTimeout(() => setRoomsMessage(""), 3000);
    } catch (err) {
      setRoomsMessage(
        err instanceof Error ? err.message : "Failed to save room settings",
      );
      setRoomsMessageType("error");
      setTimeout(() => setRoomsMessage(""), 3000);
    }
  };

  const handleResetRooms = async () => {
    try {
      await persistRooms(DEFAULT_ROOMS);
      setRoomsMessage(t("roomsReset"));
      setRoomsMessageType("success");
      setTimeout(() => setRoomsMessage(""), 3000);
    } catch (err) {
      setRoomsMessage(
        err instanceof Error ? err.message : "Failed to save room settings",
      );
      setRoomsMessageType("error");
      setTimeout(() => setRoomsMessage(""), 3000);
    }
  };

  const handleCleanupHandovers = async () => {
    if (!isAdmin) {
      setCleanupMessage(t("adminOnlyCleanup"));
      setCleanupMessageType("error");
      setTimeout(() => setCleanupMessage(""), 3000);
      return;
    }

    setCleaningUp(true);
    setCleanupMessage("");
    setCleanupMessageType(null);
    try {
      const authHeaders = await getAuthHeaders();
      const result = await cleanupOldHandoversAPI(cleanupDays, authHeaders);
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
    } catch {
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

  const handleToggleWeekendRotation = async (enabled: boolean) => {
    try {
      setSavingWeekendRotation(true);
      await updateWeekendTeamRotationEnabled(enabled);
      setWeeklyTargetsMessage(t("weekendRotationUpdated"));
      setWeeklyTargetsMessageType("success");
    } catch (error: any) {
      setWeeklyTargetsMessage(
        error?.message || t("failedUpdateWeekendRotation"),
      );
      setWeeklyTargetsMessageType("error");
    } finally {
      setSavingWeekendRotation(false);
    }
  };

  const handleChangePrintLayoutMode = async (mode: "separate" | "stacked") => {
    try {
      setSavingPrintLayoutMode(true);
      await updatePrintShiftLayoutMode(mode);
      setPrintLayoutMessage(t("printLayoutUpdated"));
      setPrintLayoutMessageType("success");
    } catch (error: any) {
      setPrintLayoutMessage(error?.message || t("failedUpdatePrintLayout"));
      setPrintLayoutMessageType("error");
    } finally {
      setSavingPrintLayoutMode(false);
      setTimeout(() => setPrintLayoutMessage(""), 4000);
    }
  };

  const scrollToSettingsSection = (sectionId: string) => {
    const target = document.getElementById(sectionId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    localStorage.setItem(CLEANUP_DAYS_STORAGE_KEY, String(cleanupDays));
  }, [cleanupDays]);

  const SETTINGS_SECTIONS = getSettingsSections(t, isAdmin);

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
            <div className="settings-section-scroller flex items-center gap-3 overflow-x-auto pb-1">
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

          {/* Logo Settings Card (Admin Only) */}
          {isAdmin && (
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
          )}

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

                    <div className="mt-4 rounded-lg border border-gray-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-gray-700">
                            {t("weekendRotationTitle")}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {t("weekendRotationDesc")}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleWeekendRotation(
                              !currentOrganization.weekend_team_rotation_enabled,
                            )
                          }
                          disabled={savingWeekendRotation}
                          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors disabled:opacity-60 ${
                            currentOrganization.weekend_team_rotation_enabled
                              ? "bg-green-100 text-green-700 hover:bg-green-200"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          {savingWeekendRotation
                            ? t("saving")
                            : currentOrganization.weekend_team_rotation_enabled
                              ? t("enabled")
                              : t("disabled")}
                        </button>
                      </div>
                    </div>

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

                    {transferMessage && (
                      <div className="mb-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                        {transferMessage}
                      </div>
                    )}

                    <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50/40 p-2 pr-1 space-y-2">
                      {approvedMembers
                        .filter((m) => m.id !== currentMembership?.id)
                        .map((member) => {
                          const memberLabel =
                            member.user_name ||
                            member.user_email ||
                            `User ${member.user_id.substring(0, 8)}...`;
                          const memberIsAdmin = member.role === "admin";
                          const isConfirming =
                            transferCandidateId === member.id;

                          return (
                            <div
                              key={member.id}
                              className="rounded-lg border border-gray-200 bg-white px-4 py-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="font-medium text-gray-900 text-sm">
                                    {memberLabel}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {member.user_email ||
                                      `ID: ${member.user_id}`}
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <span
                                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                                      memberIsAdmin
                                        ? "bg-purple-100 text-purple-800"
                                        : member.role === "manager"
                                          ? "bg-blue-100 text-blue-800"
                                          : "bg-green-100 text-green-800"
                                    }`}
                                  >
                                    {member.role || "nurse"}
                                  </span>
                                  {memberIsAdmin ? (
                                    <span className="text-xs text-gray-500">
                                      Already admin
                                    </span>
                                  ) : (
                                    !isConfirming && (
                                      <button
                                        onClick={() =>
                                          setTransferCandidateId(member.id)
                                        }
                                        disabled={transferringAdmin}
                                        className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
                                      >
                                        {t("transferAdminBtn")}
                                      </button>
                                    )
                                  )}
                                </div>
                              </div>

                              {isConfirming && (
                                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                                  <p className="text-xs text-amber-900">
                                    <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                                    This transfers full admin control of{" "}
                                    <span className="font-semibold">
                                      {currentOrganization.name}
                                    </span>{" "}
                                    to {memberLabel}. Your own role becomes
                                    nurse and you lose admin access immediately.{" "}
                                    {memberLabel} will be notified.
                                  </p>
                                  <div className="mt-3 flex items-center gap-2">
                                    <button
                                      onClick={() =>
                                        handleTransferAdmin(
                                          member.id,
                                          memberLabel,
                                        )
                                      }
                                      disabled={transferringAdmin}
                                      className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                                    >
                                      {transferringAdmin
                                        ? t("transferringAdmin")
                                        : "Yes, transfer admin"}
                                    </button>
                                    <button
                                      onClick={() =>
                                        setTransferCandidateId(null)
                                      }
                                      disabled={transferringAdmin}
                                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
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

                {/* Leave Organization (Admin Only) */}
                {isAdmin && (
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
                            t("confirmLeave", {
                              name: currentOrganization.name,
                            }),
                          )
                        )
                          return;
                        try {
                          await leaveOrganization(currentOrganization.id);
                          router.push("/dashboard");
                        } catch (err) {
                          alert(
                            err instanceof Error
                              ? err.message
                              : t("failedToLeave"),
                          );
                        }
                      }}
                      className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-red-700 rounded-lg hover:bg-red-700 transition-colors"
                    >
                      <DoorOpen className="w-4 h-4 inline mr-1" />
                      {t("leaveOrganizationActionButton")}
                    </button>
                  </div>
                )}

                {/* Delete Organization - Admin only */}
                {isAdmin && (
                  <div className="pt-4 border-t border-gray-200">
                    <label className="block text-sm font-medium text-red-700 mb-1">
                      <Trash2 className="w-4 h-4 inline mr-1" />
                      Delete Organization
                    </label>
                    <p className="text-xs text-gray-500 mb-3">
                      Permanently archive this organization and disable member
                      access. Type the organization name to confirm.
                    </p>
                    {!showDeleteOrgConfirm ? (
                      <button
                        onClick={() => setShowDeleteOrgConfirm(true)}
                        className="px-4 py-2 text-sm font-medium text-white bg-red-700 rounded-lg hover:bg-red-800 transition-colors"
                      >
                        <Trash2 className="w-4 h-4 inline mr-1" />
                        Delete Organization
                      </button>
                    ) : (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-3">
                        <p className="text-xs text-red-700">
                          This action archives the organization and removes
                          member access. Type the organization name exactly to
                          confirm.
                        </p>
                        <input
                          type="text"
                          value={deleteOrgConfirmName}
                          onChange={(e) =>
                            setDeleteOrgConfirmName(e.target.value)
                          }
                          placeholder={currentOrganization.name}
                          className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleDeleteOrganization}
                            disabled={
                              deletingOrganization ||
                              deleteOrgConfirmName.trim() !==
                                currentOrganization.name
                            }
                            className="px-4 py-2 text-sm font-medium text-white bg-red-700 rounded-lg hover:bg-red-800 transition-colors disabled:opacity-50"
                          >
                            {deletingOrganization
                              ? "Deleting..."
                              : "Confirm Delete"}
                          </button>
                          <button
                            onClick={() => {
                              setShowDeleteOrgConfirm(false);
                              setDeleteOrgConfirmName("");
                            }}
                            disabled={deletingOrganization}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Assignment Print Layout Card (Admin Only) */}
          {isAdmin && currentOrganization && (
            <div
              id="assignment-print-layout-settings"
              className="scroll-mt-36 bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6"
            >
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                {t("printLayoutCardTitle")}
              </h2>
              <p className="text-sm text-gray-600 mb-4">{t("printLayoutCardDesc")}</p>

              <div className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      {t("printLayoutTitle")}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t("printLayoutDesc")}
                    </p>
                  </div>
                  <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => handleChangePrintLayoutMode("separate")}
                      disabled={savingPrintLayoutMode}
                      className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                        (currentOrganization.print_shift_layout_mode || "separate") ===
                        "separate"
                          ? "bg-blue-600 text-white"
                          : "bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {t("printLayoutSeparate")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChangePrintLayoutMode("stacked")}
                      disabled={savingPrintLayoutMode}
                      className={`px-3 py-1.5 text-xs font-semibold transition-colors border-l border-gray-200 ${
                        (currentOrganization.print_shift_layout_mode || "separate") ===
                        "stacked"
                          ? "bg-blue-600 text-white"
                          : "bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {t("printLayoutStacked")}
                    </button>
                  </div>
                </div>
              </div>

              {printLayoutMessage && (
                <div
                  className={`mt-3 p-2 rounded-lg text-sm ${
                    printLayoutMessageType === "success"
                      ? "bg-green-50 text-green-800 border border-green-200"
                      : "bg-red-50 text-red-800 border border-red-200"
                  }`}
                >
                  {printLayoutMessage}
                </div>
              )}
            </div>
          )}

          {/* Staffing Defaults Card (Admin Only) */}
          {isAdmin && (
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
          )}

          {/* Staffing Teams Management Card */}
          {isAdmin && (
            <div
              id="staffing-teams-settings"
              className="scroll-mt-36 bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <Users className="w-6 h-6 text-indigo-600" />
                <h2 className="text-xl font-semibold text-gray-900">
                  {t("staffingTeamsTitle")}
                </h2>
                <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                  {t("admin")}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                {t("manageStaffingTeams")}
              </p>

              {/* Current Staffing Teams */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t("currentStaffingTeams")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {staffingTeams.map((team) => (
                    <div
                      key={team}
                      className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-200"
                    >
                      <span className="text-sm font-medium">{team}</span>
                      <button
                        onClick={() => handleRemoveStaffingTeam(team)}
                        className="text-indigo-600 hover:text-red-600 transition-colors"
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

              {/* Add Staffing Team */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t("addNewStaffingTeam")}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newStaffingTeam}
                    onChange={(e) => setNewStaffingTeam(e.target.value)}
                    disabled={staffingTeamsLoading}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddStaffingTeam();
                      }
                    }}
                    placeholder={t("enterStaffingTeamName")}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                  <button
                    onClick={handleAddStaffingTeam}
                    disabled={staffingTeamsLoading}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                  >
                    {tCommon("add")}
                  </button>
                </div>
              </div>

              <button
                onClick={handleResetStaffingTeams}
                disabled={staffingTeamsLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                {t("resetToDefaultStaffingTeams")}
              </button>

              {staffingTeamsMessage && (
                <div
                  className={`mt-4 p-3 rounded-lg text-sm ${
                    staffingTeamsMessageType === "success"
                      ? "bg-green-50 text-green-800 border border-green-200"
                      : "bg-red-50 text-red-800 border border-red-200"
                  }`}
                >
                  {staffingTeamsMessage}
                </div>
              )}
            </div>
          )}

          {/* Assistant Manager -> Staffing Team Mapping Card */}
          {isAdmin && (
            <div
              id="assistant-manager-mapping-settings"
              className="scroll-mt-36 bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <Users className="w-6 h-6 text-amber-600" />
                <h2 className="text-xl font-semibold text-gray-900">
                  {t("assistantManagerTeamMappingTitle")}
                </h2>
                <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                  {t("admin")}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                {t("assistantManagerTeamMappingDesc")}
              </p>

              {assistantManagers.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  {t("noAssistantManagersFound")}
                </div>
              ) : (
                <div className="space-y-3">
                  {assistantManagers.map((assistantManager) => (
                    <div
                      key={assistantManager.user_id}
                      className="rounded-lg border border-gray-200 p-3"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">
                            {assistantManager.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {assistantManager.employee_id
                              ? `${t("employeeIdLabel")}: ${assistantManager.employee_id}`
                              : t("assistantManagerNoEmployeeId")}
                          </p>
                        </div>
                        <select
                          value={
                            assistantManagerTeamMap[assistantManager.user_id] ||
                            (assistantManager.nurse_id
                              ? assistantManagerTeamMap[assistantManager.nurse_id] || ""
                              : "")
                          }
                          onChange={(e) =>
                            handleAssistantManagerTeamChange(
                              assistantManager.user_id,
                              e.target.value,
                              assistantManager.nurse_id,
                            )
                          }
                          disabled={assistantManagerMapSaving}
                          className="min-w-56 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm"
                        >
                          <option value="">{t("selectStaffingTeam")}</option>
                          {staffingTeams.map((team) => (
                            <option key={team} value={team}>
                              {team}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {assistantManagerMapMessage && (
                <div
                  className={`mt-4 p-3 rounded-lg text-sm ${
                    assistantManagerMapMessageType === "success"
                      ? "bg-green-50 text-green-800 border border-green-200"
                      : "bg-red-50 text-red-800 border border-red-200"
                  }`}
                >
                  {assistantManagerMapMessage}
                </div>
              )}
            </div>
          )}

          {/* Services Management Card */}
          {isAdmin && (
            <div
              id="services-settings"
              className="scroll-mt-36 bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <Users className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-semibold text-gray-900">
                  {t("servicesTitle")}
                </h2>
                <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                  {t("admin")}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-4">{t("manageServices")}</p>
              <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                <p className="text-xs text-blue-800">{t("servicesStaffingHint")}</p>
              </div>

              {/* Current Teams */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t("currentServices")}
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
                  {t("addNewService")}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTeam}
                    onChange={(e) => setNewTeam(e.target.value)}
                    disabled={teamsLoading}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddTeam();
                      }
                    }}
                    placeholder={t("enterServiceName")}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                    onClick={handleAddTeam}
                    disabled={teamsLoading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    {tCommon("add")}
                  </button>
                </div>
              </div>

              {/* Reset Button */}
              <button
                onClick={handleResetTeams}
                disabled={teamsLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                {t("resetToDefaultServices")}
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
          )}

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
                            disabled={roomsLoading}
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
                            disabled={roomsLoading}
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
                            disabled={roomsLoading}
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
                    disabled={roomsLoading}
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
                    disabled={roomsLoading}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                  >
                    {tCommon("add")}
                  </button>
                </div>
              </div>

              {/* Reset Button */}
              <button
                onClick={handleResetRooms}
                disabled={roomsLoading}
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

          {/* Data Management Card (Admin Only) */}
          {isAdmin && (
            <div
              id="data-management"
              className="scroll-mt-36 bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <Trash2 className="w-6 h-6 text-red-600" />
                <h2 className="text-xl font-semibold text-gray-900">
                  {t("dataManagement")}
                </h2>
                <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                  {t("admin")}
                </span>
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
          )}

          {/* Roles & Permissions (admin only) */}
          <div className="scroll-mt-36">
            <RolePermissionsSection />
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
