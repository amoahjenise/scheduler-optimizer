"use client";

import { useCallback, useEffect, useState } from "react";
import { Shield, Loader2, Check } from "lucide-react";
import {
  useOrganization,
  ALL_PERMISSIONS,
  MAX_ASSISTANT_MANAGERS,
  type MemberRoleValue,
} from "../context/OrganizationContext";
import { getApiBase } from "../lib/runtimeApiBase";

interface MemberRow {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  role: MemberRoleValue;
  is_active: boolean;
  is_approved: boolean;
}

const PERMISSION_LABELS: Record<string, string> = {
  manage_nurses: "Manage staff",
  manage_schedules: "Create & edit schedules",
  manage_patients: "Manage patients",
  manage_handovers: "Manage hand-off reports",
  manage_announcements: "Publish announcements",
  manage_learning: "Manage learning modules",
  view_burnout: "View burnout insights",
  manage_members: "Approve & manage members",
  manage_org_settings: "Change organization settings",
};

const ASSIGNABLE_ROLES: { value: MemberRoleValue; label: string }[] = [
  { value: "manager", label: "Manager" },
  { value: "assistant_manager", label: "Assistant manager" },
  { value: "nurse", label: "Nurse" },
];

export default function RolePermissionsSection() {
  const { currentOrganization, isAdmin, getAuthHeaders, refreshOrganizations } =
    useOrganization();
  const orgId = currentOrganization?.id;

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [managerPerms, setManagerPerms] = useState<string[]>([]);
  const [assistantPerms, setAssistantPerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError("");
    try {
      const headers = await getAuthHeaders();
      const [permsRes, membersRes] = await Promise.all([
        fetch(`${getApiBase()}/organizations/${orgId}/role-permissions`, {
          headers,
        }),
        fetch(`${getApiBase()}/organizations/${orgId}/members`, { headers }),
      ]);

      if (permsRes.ok) {
        const data = await permsRes.json();
        setManagerPerms(data.manager_permissions || []);
        setAssistantPerms(data.assistant_manager_permissions || []);
      }
      if (membersRes.ok) {
        const data = await membersRes.json();
        setMembers(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load roles");
    } finally {
      setLoading(false);
    }
  }, [orgId, getAuthHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (role: "manager" | "assistant", permission: string) => {
    const setter = role === "manager" ? setManagerPerms : setAssistantPerms;
    setter((prev) =>
      prev.includes(permission)
        ? prev.filter((p) => p !== permission)
        : [...prev, permission],
    );
  };

  const savePermissions = async () => {
    if (!orgId) return;
    setSaving(true);
    setError("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${getApiBase()}/organizations/${orgId}/role-permissions`,
        {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            manager_permissions: managerPerms,
            assistant_manager_permissions: assistantPerms,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Failed to save permissions");
      }
      setSavedAt(new Date());
      // Permissions live on the organization, so refresh the cached copy.
      await refreshOrganizations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save permissions");
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (memberId: string, role: MemberRoleValue) => {
    if (!orgId) return;
    setError("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${getApiBase()}/organizations/${orgId}/members/${memberId}`,
        {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Failed to change role");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to change role");
    }
  };

  if (!isAdmin) return null;

  const assistantCount = members.filter(
    (m) => m.role === "assistant_manager" && m.is_active,
  ).length;

  const renderMatrix = (
    title: string,
    hint: string,
    selected: string[],
    role: "manager" | "assistant",
  ) => (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="mb-1 text-sm font-semibold text-gray-900">{title}</div>
      <p className="mb-3 text-xs text-gray-500">{hint}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ALL_PERMISSIONS.map((permission) => {
          const checked = selected.includes(permission);
          return (
            <label
              key={permission}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm transition-colors ${
                checked
                  ? "border-blue-400 bg-blue-50 text-blue-900"
                  : "border-gray-200 text-gray-700 hover:border-gray-300"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(role, permission)}
                className="h-4 w-4"
              />
              {PERMISSION_LABELS[permission] || permission}
            </label>
          );
        })}
      </div>
    </div>
  );

  return (
    <section
      id="role-permissions"
      className="rounded-2xl border border-gray-200 bg-white p-6"
    >
      <div className="mb-4 flex items-center gap-2">
        <Shield className="h-5 w-5 text-purple-600" />
        <h2 className="text-lg font-semibold text-gray-900">
          Roles &amp; Permissions
        </h2>
      </div>
      <p className="mb-5 text-sm text-gray-500">
        You are the admin of this organization. Choose what managers and
        assistant managers are allowed to do. Assigning a nurse to a hand-off is
        always available to every member, including nurses.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading roles…
        </div>
      ) : (
        <>
          <div className="mb-5 space-y-3">
            {renderMatrix(
              "Manager",
              "Defaults to everything an admin can do.",
              managerPerms,
              "manager",
            )}
            {renderMatrix(
              "Assistant manager",
              `Stands in when the manager is away. Up to ${MAX_ASSISTANT_MANAGERS} assistant managers (${assistantCount} assigned).`,
              assistantPerms,
              "assistant",
            )}
          </div>

          <div className="mb-6 flex items-center gap-3">
            <button
              onClick={savePermissions}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Save permissions
            </button>
            {savedAt && !saving && (
              <span className="text-xs text-gray-500">
                Saved {savedAt.toLocaleTimeString()}
              </span>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-900">
              Staff roles
            </h3>
            <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
              {members.filter((m) => m.is_approved).length === 0 && (
                <p className="p-4 text-sm text-gray-500">
                  No approved members yet.
                </p>
              )}
              {members
                .filter((m) => m.is_approved)
                .map((member) => {
                  const isOwnerAdmin = member.role === "admin";
                  return (
                    <div
                      key={member.id}
                      className="flex items-center justify-between gap-3 p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {member.user_name ||
                            member.user_email ||
                            member.user_id}
                        </p>
                        {member.user_email && (
                          <p className="truncate text-xs text-gray-500">
                            {member.user_email}
                          </p>
                        )}
                      </div>
                      {isOwnerAdmin ? (
                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                          Admin
                        </span>
                      ) : (
                        <select
                          value={member.role}
                          onChange={(e) =>
                            changeRole(
                              member.id,
                              e.target.value as MemberRoleValue,
                            )
                          }
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
                        >
                          {ASSIGNABLE_ROLES.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
