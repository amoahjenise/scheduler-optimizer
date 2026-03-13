"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import {
  Upload,
  RefreshCw,
  Eye,
  EyeOff,
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

const DEFAULT_LOGO = "/logo-placeholder.png";

export default function SettingsPage() {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const {
    currentOrganization,
    currentMembership,
    isAdmin,
    organizations,
    updateOrganizationLogo,
    updateOrganizationWeeklyTargets,
  } = useOrganization();
  const [logoUrl, setLogoUrl] = useState(DEFAULT_LOGO);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [showUserId, setShowUserId] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [teams, setTeams] = useState<string[]>(DEFAULT_TEAMS);
  const [newTeam, setNewTeam] = useState("");
  const [teamsMessage, setTeamsMessage] = useState("");
  const [rooms, setRooms] = useState<string[]>(DEFAULT_ROOMS);
  const [newRoom, setNewRoom] = useState("");
  const [roomsMessage, setRoomsMessage] = useState("");
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [editRoomValue, setEditRoomValue] = useState("");
  const [cleanupDays, setCleanupDays] = useState(30);
  const [cleanupMessage, setCleanupMessage] = useState("");
  const [cleaningUp, setCleaningUp] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [fullTimeWeeklyTarget, setFullTimeWeeklyTarget] = useState(37.5);
  const [partTimeWeeklyTarget, setPartTimeWeeklyTarget] = useState(26.25);
  const [savingWeeklyTargets, setSavingWeeklyTargets] = useState(false);
  const [weeklyTargetsMessage, setWeeklyTargetsMessage] = useState("");

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
      setFullTimeWeeklyTarget(
        currentOrganization.full_time_weekly_target ?? 37.5,
      );
      setPartTimeWeeklyTarget(
        currentOrganization.part_time_weekly_target ?? 26.25,
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
      setTeamsMessage("Team already exists");
      setTimeout(() => setTeamsMessage(""), 3000);
      return;
    }

    const updatedTeams = addTeam(trimmed);
    setTeams(updatedTeams);
    setNewTeam("");
    setTeamsMessage("Team added successfully");
    setTimeout(() => setTeamsMessage(""), 3000);
  };

  const handleRemoveTeam = (teamToRemove: string) => {
    const updatedTeams = removeTeam(teamToRemove);
    setTeams(updatedTeams);
    setTeamsMessage("Team removed");
    setTimeout(() => setTeamsMessage(""), 3000);
  };

  const handleResetTeams = () => {
    const updatedTeams = resetTeams();
    setTeams(updatedTeams);
    setTeamsMessage("Teams reset to default");
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
      setRoomsMessage("Room already exists");
      setTimeout(() => setRoomsMessage(""), 3000);
      return;
    }

    const updatedRooms = addRoom(trimmed);
    setRooms(updatedRooms);
    setNewRoom("");
    setRoomsMessage("Room added successfully");
    setTimeout(() => setRoomsMessage(""), 3000);
  };

  const handleRemoveRoom = (roomToRemove: string) => {
    const updatedRooms = removeRoom(roomToRemove);
    setRooms(updatedRooms);
    setRoomsMessage("Room removed");
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
      setRoomsMessage("Room name cannot be empty");
      setTimeout(() => setRoomsMessage(""), 3000);
      return;
    }
    if (trimmed !== editingRoom && rooms.includes(trimmed)) {
      setRoomsMessage("Room already exists");
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
    setRoomsMessage("Room updated successfully");
    setTimeout(() => setRoomsMessage(""), 3000);
  };

  const handleResetRooms = () => {
    const defaultRooms = resetRooms();
    setRooms(defaultRooms);
    setRoomsMessage("Rooms reset to default");
    setTimeout(() => setRoomsMessage(""), 3000);
  };

  const handleCleanupHandovers = async () => {
    setCleaningUp(true);
    setCleanupMessage("");
    try {
      const result = await cleanupOldHandoversAPI(cleanupDays);
      setCleanupMessage(result.message);
      setShowCleanupConfirm(false);
    } catch (error) {
      setCleanupMessage(
        error instanceof Error ? error.message : "Failed to cleanup handovers",
      );
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
      setMessage("Please upload an image file");
      setTimeout(() => setMessage(""), 3000);
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setMessage("File size must be less than 2MB");
      setTimeout(() => setMessage(""), 3000);
      return;
    }

    if (!isAdmin) {
      setMessage("Only admins can update the organization logo");
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
          setMessage(
            "Logo updated successfully! All organization members will see the new logo.",
          );
          setTimeout(() => setMessage(""), 5000);
        } catch (error) {
          setMessage(
            error instanceof Error ? error.message : "Failed to upload logo",
          );
          setTimeout(() => setMessage(""), 3000);
        } finally {
          setUploading(false);
        }
      };
      reader.onerror = () => {
        setMessage("Failed to read file");
        setTimeout(() => setMessage(""), 3000);
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      setMessage("Failed to upload logo");
      setTimeout(() => setMessage(""), 3000);
      setUploading(false);
    }
  };

  const handleReset = async () => {
    if (!isAdmin) {
      setMessage("Only admins can reset the organization logo");
      setTimeout(() => setMessage(""), 3000);
      return;
    }

    setUploading(true);
    try {
      await updateOrganizationLogo("");
      setLogoUrl(DEFAULT_LOGO);
      setMessage("Logo reset to default.");
      setTimeout(() => setMessage(""), 5000);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to reset logo",
      );
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
      setWeeklyTargetsMessage("Only admins can update weekly targets");
      setTimeout(() => setWeeklyTargetsMessage(""), 3000);
      return;
    }

    if (
      fullTimeWeeklyTarget < 0 ||
      fullTimeWeeklyTarget > 168 ||
      partTimeWeeklyTarget < 0 ||
      partTimeWeeklyTarget > 168
    ) {
      setWeeklyTargetsMessage("Weekly targets must be between 0 and 168");
      setTimeout(() => setWeeklyTargetsMessage(""), 3000);
      return;
    }

    setSavingWeeklyTargets(true);
    try {
      await updateOrganizationWeeklyTargets(
        fullTimeWeeklyTarget,
        partTimeWeeklyTarget,
      );
      setWeeklyTargetsMessage("Weekly targets saved successfully");
    } catch (error) {
      setWeeklyTargetsMessage(
        error instanceof Error
          ? error.message
          : "Failed to save weekly targets",
      );
    } finally {
      setSavingWeeklyTargets(false);
      setTimeout(() => setWeeklyTargetsMessage(""), 4000);
    }
  };

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
              <span className="text-sm font-medium">Back</span>
            </button>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Settings</h1>
            <p className="text-gray-600">
              Customize your application preferences
            </p>
          </div>

          {/* Logo Settings Card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Logo Settings
            </h2>

            {/* Current Logo Preview */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Current Logo
              </label>
              <div className="flex items-center gap-4">
                <div className="w-32 h-32 border-2 border-gray-200 rounded-lg flex items-center justify-center bg-gray-50 p-4">
                  <img
                    src={logoUrl}
                    alt="Current Logo"
                    className="max-w-full max-h-full object-contain"
                    onError={(e) => {
                      e.currentTarget.src = "/MCH Logo.png";
                    }}
                  />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-600 mb-2">
                    Upload a custom logo to replace the default Chronofy logo.
                    The logo will appear in the header.
                  </p>
                  <p className="text-xs text-gray-500">
                    Recommended: PNG or SVG format, transparent background, max
                    2MB
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
                      {uploading ? "Uploading..." : "Click to upload new logo"}
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
                Reset to Default Logo
              </button>
            </div>

            {/* Message Display */}
            {message && (
              <div
                className={`mt-4 p-3 rounded-lg text-sm ${
                  message.includes("successfully") || message.includes("reset")
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
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
              <div className="flex items-center gap-3 mb-4">
                <Building2 className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-semibold text-gray-900">
                  Organization Settings
                </h2>
              </div>

              <div className="space-y-4">
                {/* Organization Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">
                    Organization Name
                  </label>
                  <p className="text-gray-900 font-medium">
                    {currentOrganization.name}
                  </p>
                </div>

                {/* Your Role */}
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">
                    Your Role
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
                    {currentMembership?.role || "Member"}
                  </span>
                </div>

                {/* Weekly Hour Defaults - Admin Only */}
                {isAdmin && (
                  <div className="pt-4 border-t border-gray-200">
                    <label className="block text-sm font-medium text-gray-600 mb-2">
                      Weekly Hour Defaults
                    </label>
                    <p className="text-xs text-gray-500 mb-3">
                      Set organization defaults used when creating Full-Time and
                      Part-Time staff entries.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Full-Time target (hours/week)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={168}
                          step={0.5}
                          value={fullTimeWeeklyTarget}
                          onChange={(e) =>
                            setFullTimeWeeklyTarget(
                              parseFloat(e.target.value) || 0,
                            )
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Part-Time target (hours/week)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={168}
                          step={0.5}
                          value={partTimeWeeklyTarget}
                          onChange={(e) =>
                            setPartTimeWeeklyTarget(
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
                        ? "Saving..."
                        : "Save Weekly Targets"}
                    </button>

                    {weeklyTargetsMessage && (
                      <div
                        className={`mt-3 p-2 rounded-lg text-sm ${
                          weeklyTargetsMessage.includes("success")
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
                      Team Invite Code
                    </label>
                    <p className="text-xs text-gray-500 mb-3">
                      Share this code with team members so they can join your
                      organization.
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
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            Copy
                          </>
                        )}
                      </button>
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
              </div>
            </div>
          )}

          {/* Teams Management Card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <Users className="w-6 h-6 text-blue-600" />
              <h2 className="text-xl font-semibold text-gray-900">Teams</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Manage teams that can be assigned to patients and staff.
            </p>

            {/* Current Teams */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Current Teams
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
                      title="Remove team"
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
                Add New Team
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
                  placeholder="Enter team name..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <button
                  onClick={handleAddTeam}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Reset Button */}
            <button
              onClick={handleResetTeams}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Reset to Default Teams
            </button>

            {/* Teams Message */}
            {teamsMessage && (
              <div
                className={`mt-4 p-3 rounded-lg text-sm ${
                  teamsMessage.includes("successfully") ||
                  teamsMessage.includes("reset") ||
                  teamsMessage.includes("removed")
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
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
              <div className="flex items-center gap-3 mb-4">
                <DoorOpen className="w-6 h-6 text-green-600" />
                <h2 className="text-xl font-semibold text-gray-900">Rooms</h2>
                <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                  Admin
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Manage rooms that can be assigned to patients. These rooms
                appear as suggestions when adding patients.
              </p>

              {/* Current Rooms */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Current Rooms
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
                            title="Save"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingRoom(null);
                              setEditRoomValue("");
                            }}
                            className="text-gray-500 hover:text-gray-700 transition-colors"
                            title="Cancel"
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
                            title="Edit room"
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
                            title="Remove room"
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
                  Add New Room
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
                    placeholder="Enter room number (e.g., B7.17)..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                  <button
                    onClick={handleAddRoom}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Reset Button */}
              <button
                onClick={handleResetRooms}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Reset to Default Rooms
              </button>

              {/* Rooms Message */}
              {roomsMessage && (
                <div
                  className={`mt-4 p-3 rounded-lg text-sm ${
                    roomsMessage.includes("successfully") ||
                    roomsMessage.includes("reset") ||
                    roomsMessage.includes("removed") ||
                    roomsMessage.includes("updated")
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
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <Trash2 className="w-6 h-6 text-red-600" />
              <h2 className="text-xl font-semibold text-gray-900">
                Data Management
              </h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Clean up old hand-off reports to keep your database manageable.
            </p>

            {/* Cleanup Days Selector */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Keep hand-offs from the last
              </label>
              <div className="flex items-center gap-3">
                <select
                  value={cleanupDays}
                  onChange={(e) => setCleanupDays(Number(e.target.value))}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                  <option value={180}>180 days</option>
                  <option value={365}>1 year</option>
                </select>
                <span className="text-sm text-gray-500">
                  (older hand-offs will be deleted)
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
                Clean Up Old Hand-offs
              </button>
            ) : (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-3 mb-4">
                  <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-800">
                      Are you sure you want to delete old hand-offs?
                    </p>
                    <p className="text-sm text-red-700 mt-1">
                      This will permanently delete all hand-off reports older
                      than <strong>{cleanupDays} days</strong>. This action
                      cannot be undone.
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
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        Yes, Delete Old Hand-offs
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setShowCleanupConfirm(false)}
                    disabled={cleaningUp}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white rounded-lg hover:bg-gray-100 transition-colors border border-gray-300 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Cleanup Message */}
            {cleanupMessage && (
              <div
                className={`mt-4 p-3 rounded-lg text-sm ${
                  cleanupMessage.includes("Deleted")
                    ? "bg-green-50 text-green-800 border border-green-200"
                    : "bg-red-50 text-red-800 border border-red-200"
                }`}
              >
                {cleanupMessage}
              </div>
            )}
          </div>

          {/* User Info Card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Account Information
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-600">
                  Email
                </label>
                <p className="text-gray-900">
                  {user?.primaryEmailAddress?.emailAddress || "N/A"}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600">
                  Name
                </label>
                <p className="text-gray-900">{user?.fullName || "N/A"}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600">
                  User ID
                </label>
                <div className="flex items-center gap-2">
                  <p className="text-gray-900 font-mono text-sm">
                    {showUserId
                      ? user?.id || "N/A"
                      : user?.id
                        ? `${user.id.substring(0, 8)}${"".padStart(user.id.length - 8, "•")}`
                        : "N/A"}
                  </p>
                  {user?.id && (
                    <button
                      onClick={() => setShowUserId(!showUserId)}
                      className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                      title={showUserId ? "Hide User ID" : "Show User ID"}
                    >
                      {showUserId ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
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
