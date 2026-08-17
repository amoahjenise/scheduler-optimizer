"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Megaphone,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import { useOrganization } from "../context/OrganizationContext";
import { fetchAndCacheOrganizationConfig } from "../lib/orgConfig";
import {
  fetchAnnouncementsAPI,
  createAnnouncementAPI,
  updateAnnouncementAPI,
  deleteAnnouncementAPI,
  type Announcement,
} from "../lib/api";

const ALL_TEAMS = "__all__";

function formatDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function isExpired(announcement: Announcement): boolean {
  if (!announcement.expires_at) return false;
  return new Date(announcement.expires_at).getTime() <= Date.now();
}

export default function AnnouncementsPage() {
  const { currentOrganization, canManage, getAuthHeaders } = useOrganization();
  const orgId = currentOrganization?.id;

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetTeam, setTargetTeam] = useState<string>(ALL_TEAMS);
  const [isPinned, setIsPinned] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const [data, config] = await Promise.all([
        fetchAnnouncementsAPI(headers, canManage),
        fetchAndCacheOrganizationConfig(orgId, headers).catch(() => null),
      ]);
      setAnnouncements(data);
      setTeams(config?.team_options ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load announcements");
    } finally {
      setLoading(false);
    }
  }, [orgId, canManage, getAuthHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setTitle("");
    setBody("");
    setTargetTeam(ALL_TEAMS);
    setIsPinned(false);
    setExpiresAt("");
  };

  const handleCreate = async () => {
    if (!title.trim() || !body.trim()) {
      setError("Title and message are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      await createAnnouncementAPI(
        {
          title: title.trim(),
          body: body.trim(),
          target_team: targetTeam === ALL_TEAMS ? null : targetTeam,
          is_pinned: isPinned,
          expires_at: expiresAt
            ? new Date(`${expiresAt}T23:59:59`).toISOString()
            : null,
        },
        headers,
      );
      resetForm();
      setShowForm(false);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to create announcement",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePin = async (announcement: Announcement) => {
    try {
      const headers = await getAuthHeaders();
      await updateAnnouncementAPI(
        announcement.id,
        { is_pinned: !announcement.is_pinned },
        headers,
      );
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to update announcement",
      );
    }
  };

  const handleDelete = async (announcement: Announcement) => {
    if (!confirm(`Delete announcement "${announcement.title}"?`)) return;
    try {
      const headers = await getAuthHeaders();
      await deleteAnnouncementAPI(announcement.id, headers);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to delete announcement",
      );
    }
  };

  const { pinned, regular } = useMemo(() => {
    return {
      pinned: announcements.filter((a) => a.is_pinned),
      regular: announcements.filter((a) => !a.is_pinned),
    };
  }, [announcements]);

  const renderCard = (announcement: Announcement) => {
    const expired = isExpired(announcement);
    return (
      <div
        key={announcement.id}
        className={`rounded-xl border p-5 ${
          announcement.is_pinned
            ? "border-blue-200 bg-blue-50"
            : "border-gray-200 bg-white"
        } ${expired ? "opacity-60" : ""}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {announcement.is_pinned && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white">
                  <Pin className="h-3 w-3" /> Pinned
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                <Users className="h-3 w-3" />
                {announcement.target_team || "Entire organization"}
              </span>
              {expired && (
                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                  Expired
                </span>
              )}
            </div>
            <h3 className="mt-2 text-lg font-semibold text-gray-900">
              {announcement.title}
            </h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
              {announcement.body}
            </p>
            <p className="mt-3 text-xs text-gray-500">
              {announcement.created_by_name
                ? `${announcement.created_by_name} · `
                : ""}
              {formatDate(announcement.created_at)}
              {announcement.expires_at
                ? ` · Expires ${formatDate(announcement.expires_at)}`
                : ""}
            </p>
          </div>

          {canManage && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => handleTogglePin(announcement)}
                title={announcement.is_pinned ? "Unpin" : "Pin"}
                className="rounded-lg border border-gray-300 bg-white p-2 text-gray-600 hover:bg-gray-50"
              >
                {announcement.is_pinned ? (
                  <PinOff className="h-4 w-4" />
                ) : (
                  <Pin className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={() => handleDelete(announcement)}
                title="Delete"
                className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-600 hover:bg-red-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="page-frame py-8">
      <div className="page-container">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-3xl font-bold text-gray-900">
                <Megaphone className="h-7 w-7 text-blue-600" />
                Announcements
              </h1>
              <p className="mt-1 text-gray-600">
                Unit-wide and team-specific updates for your organization.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={load}
                className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <RefreshCw className="h-4 w-4" /> Refresh
              </button>
              {canManage && (
                <button
                  onClick={() => setShowForm((prev) => !prev)}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" /> New
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}

          {canManage && showForm && (
            <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">
                New announcement
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Title
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., New isolation protocol starts Monday"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Message
                  </label>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={4}
                    placeholder="Write the announcement details..."
                    className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Audience
                    </label>
                    <select
                      value={targetTeam}
                      onChange={(e) => setTargetTeam(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                    >
                      <option value={ALL_TEAMS}>Entire organization</option>
                      {teams.map((team) => (
                        <option key={team} value={team}>
                          {team}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Expires on (optional)
                    </label>
                    <input
                      type="date"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={isPinned}
                    onChange={(e) => setIsPinned(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  Pin to the top
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCreate}
                    disabled={saving}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? "Publishing..." : "Publish"}
                  </button>
                  <button
                    onClick={() => {
                      setShowForm(false);
                      resetForm();
                    }}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-gray-500">Loading announcements...</p>
          ) : announcements.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
              <Megaphone className="mx-auto h-8 w-8 text-gray-400" />
              <p className="mt-3 font-medium text-gray-700">
                No announcements yet
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {canManage
                  ? "Publish an announcement to keep your unit aligned."
                  : "Check back later for updates from your managers."}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {pinned.map(renderCard)}
              {pinned.length > 0 && regular.length > 0 && (
                <div className="pt-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                  Earlier
                </div>
              )}
              {regular.map(renderCard)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
