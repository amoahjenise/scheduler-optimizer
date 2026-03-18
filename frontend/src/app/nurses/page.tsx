"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import {
  listNursesAPI,
  createNurseAPI,
  updateNurseAPI,
  deleteNurseAPI,
  type Nurse,
  type NurseCreate,
} from "../lib/api";
import { useOrganization } from "../context/OrganizationContext";

interface FormData {
  name: string;
  employee_id: string;
  seniority: string;
  employment_type: "full-time" | "part-time";
  max_weekly_hours: number;
  is_chemo_certified: boolean;
  is_transplant_certified: boolean;
  is_renal_certified: boolean;
  is_charge_certified: boolean;
  other_certifications: string;
  // Leave status
  is_on_maternity_leave: boolean;
  is_on_sick_leave: boolean;
  is_on_sabbatical: boolean;
}

export default function NursesPage() {
  const { user } = useUser();
  const {
    currentOrganization,
    getAuthHeaders,
    isLoading: orgLoading,
  } = useOrganization();
  const t = useTranslations("nurses");
  const fullTimeBiWeeklyTarget =
    currentOrganization?.full_time_weekly_target ?? 75;
  const partTimeBiWeeklyTarget =
    currentOrganization?.part_time_weekly_target ?? 63.75;

  const getDefaultFormData = (): FormData => ({
    name: "",
    employee_id: "",
    seniority: "",
    employment_type: "full-time",
    max_weekly_hours: fullTimeBiWeeklyTarget,
    is_chemo_certified: false,
    is_transplant_certified: false,
    is_renal_certified: false,
    is_charge_certified: false,
    other_certifications: "",
    is_on_maternity_leave: false,
    is_on_sick_leave: false,
    is_on_sabbatical: false,
  });

  const [nurses, setNurses] = useState<Nurse[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingNurse, setEditingNurse] = useState<Nurse | null>(null);
  const [formData, setFormData] = useState<FormData>(getDefaultFormData);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user?.id && !orgLoading && currentOrganization) {
      loadNurses();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, orgLoading, currentOrganization, searchTerm]);

  const loadNurses = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const authHeaders = await getAuthHeaders();
      const data = await listNursesAPI(
        user.id,
        1,
        100,
        searchTerm || undefined,
        authHeaders,
      );
      setNurses(data.nurses);
    } catch (error) {
      console.error("Failed to load nurses:", error);
      alert("Failed to load nurses");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingNurse(null);
    setFormData(getDefaultFormData());
    setShowModal(true);
  };

  const handleEdit = (nurse: Nurse) => {
    setEditingNurse(nurse);
    setFormData({
      name: nurse.name,
      employee_id: nurse.employee_id || "",
      seniority: nurse.seniority || "",
      employment_type: nurse.employment_type,
      max_weekly_hours: nurse.max_weekly_hours,
      is_chemo_certified: nurse.is_chemo_certified,
      is_transplant_certified: nurse.is_transplant_certified || false,
      is_renal_certified: nurse.is_renal_certified || false,
      is_charge_certified: nurse.is_charge_certified || false,
      other_certifications: nurse.other_certifications || "",
      is_on_maternity_leave: nurse.is_on_maternity_leave || false,
      is_on_sick_leave: nurse.is_on_sick_leave || false,
      is_on_sabbatical: nurse.is_on_sabbatical || false,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;

    setSaving(true);
    try {
      const payload: NurseCreate = {
        name: formData.name,
        employee_id: formData.employee_id || undefined,
        seniority: formData.seniority || undefined,
        employment_type: formData.employment_type,
        max_weekly_hours: formData.max_weekly_hours,
        is_chemo_certified: formData.is_chemo_certified,
        is_transplant_certified: formData.is_transplant_certified,
        is_renal_certified: formData.is_renal_certified,
        is_charge_certified: formData.is_charge_certified,
        other_certifications: formData.other_certifications || undefined,
        is_on_maternity_leave: formData.is_on_maternity_leave,
        is_on_sick_leave: formData.is_on_sick_leave,
        is_on_sabbatical: formData.is_on_sabbatical,
      };

      console.log("[Nurse Update] Submitting payload:", payload);

      const authHeaders = await getAuthHeaders();

      if (editingNurse) {
        const updated = await updateNurseAPI(
          editingNurse.id,
          user.id,
          payload,
          authHeaders,
        );
        console.log("[Nurse Update] Response:", updated);
        // Update the nurse in-place without reloading the entire list
        setNurses((prev) =>
          prev.map((n) => (n.id === editingNurse.id ? updated : n)),
        );
      } else {
        await createNurseAPI(user.id, payload, authHeaders);
        // Only reload for new nurses to add them to the list
        loadNurses();
      }
      setShowModal(false);
    } catch (error: any) {
      console.error("[Nurse Update] Error:", error);
      alert(error.message || "Failed to save nurse");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (nurseId: string) => {
    if (!user?.id) return;
    if (!confirm(t("deleteConfirm"))) return;

    try {
      const authHeaders = await getAuthHeaders();
      await deleteNurseAPI(nurseId, user.id, authHeaders);
      loadNurses();
    } catch (error: any) {
      alert(error.message || "Failed to delete nurse");
    }
  };

  return (
    <div className="page-frame">
      <div className="page-container py-8">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/dashboard"
            className="text-sm text-blue-600 hover:underline mb-1 inline-block"
          >
            {t("backToDashboard")}
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                {t("staffManagement")}
              </h1>
              <p className="text-gray-500 text-sm mt-1">
                {nurses.length}{" "}
                {nurses.length === 1 ? t("teamMember") : t("teamMembers")}
              </p>
            </div>
            <button
              onClick={handleCreate}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              {t("addStaffMember")}
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder={t("searchPlaceholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>
        </div>

        {/* Staff List */}
        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-16 text-center">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-500 text-sm">{t("loadingStaff")}</p>
          </div>
        ) : nurses.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-16 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                />
              </svg>
            </div>
            <p className="text-gray-900 font-medium text-lg mb-1">
              {t("noStaffYet")}
            </p>
            <p className="text-gray-500 text-sm">{t("addFirstMember")}</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {nurses.map((nurse) => {
              const badges = [];
              if (nurse.is_chemo_certified)
                badges.push({ label: t("chemo"), color: "green", icon: "💉" });
              if (nurse.is_transplant_certified)
                badges.push({
                  label: t("transplant"),
                  color: "purple",
                  icon: "🫀",
                });
              if (nurse.is_renal_certified)
                badges.push({ label: t("renal"), color: "blue", icon: "🩺" });
              if (nurse.is_charge_certified)
                badges.push({ label: t("charge"), color: "amber", icon: "⭐" });

              // Check if nurse is on any leave
              const isOnLeave =
                nurse.is_on_maternity_leave ||
                nurse.is_on_sick_leave ||
                nurse.is_on_sabbatical;
              const leaveTypes = [];
              if (nurse.is_on_maternity_leave)
                leaveTypes.push(t("maternityShort"));
              if (nurse.is_on_sick_leave) leaveTypes.push(t("sickShort"));
              if (nurse.is_on_sabbatical) leaveTypes.push(t("sabbaticalShort"));

              return (
                <div
                  key={nurse.id}
                  className={`bg-white rounded-xl shadow-sm border p-5 hover:shadow-md transition-shadow ${
                    isOnLeave
                      ? "border-orange-300 bg-orange-50/30"
                      : "border-gray-200"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      {/* Avatar */}
                      <div
                        className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                          isOnLeave
                            ? "bg-gradient-to-br from-orange-400 to-orange-500"
                            : "bg-gradient-to-br from-blue-500 to-purple-500"
                        }`}
                      >
                        <span className="text-white font-semibold text-sm">
                          {nurse.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase()}
                        </span>
                      </div>

                      {/* Info */}
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-900 text-lg">
                            {nurse.name}
                          </h3>
                          {isOnLeave && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-medium rounded-full">
                              🚫 {t("onLeave")}
                            </span>
                          )}
                        </div>
                        {isOnLeave && (
                          <p className="text-xs text-orange-600 mt-0.5">
                            {leaveTypes.join(" + ")} Leave — {t("notAvailable")}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
                          {nurse.employee_id && (
                            <span className="flex items-center gap-1">
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2"
                                />
                              </svg>
                              ID: {nurse.employee_id}
                            </span>
                          )}
                          {nurse.seniority && (
                            <span className="flex items-center gap-1">
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                              {nurse.seniority}
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              nurse.employment_type === "full-time"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-purple-100 text-purple-700"
                            }`}
                          >
                            {nurse.employment_type === "full-time"
                              ? t("fullTime")
                              : t("partTime")}
                          </span>
                          <span className="text-gray-600">
                            {nurse.max_weekly_hours} {t("hoursPerBiweekly")}
                          </span>
                        </div>

                        {/* Certifications */}
                        {badges.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-3">
                            {badges.map((badge) => (
                              <span
                                key={badge.label}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                                  badge.color === "green"
                                    ? "bg-green-100 text-green-700"
                                    : badge.color === "purple"
                                      ? "bg-purple-100 text-purple-700"
                                      : badge.color === "blue"
                                        ? "bg-blue-100 text-blue-700"
                                        : "bg-amber-100 text-amber-700"
                                }`}
                              >
                                {badge.icon} {badge.label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEdit(nurse)}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                        title="Edit"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(nurse.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="Delete"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                <h2 className="text-xl font-semibold text-gray-900">
                  {editingNurse ? t("editStaffMember") : t("addStaffMember")}
                </h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
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

              <div className="flex-1 overflow-y-auto">
                <form
                  id="nurse-form"
                  onSubmit={handleSubmit}
                  className="p-6 space-y-5"
                >
                  {/* Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      {t("fullName")} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      placeholder="e.g., Jane Doe"
                    />
                  </div>

                  {/* Employee ID & Seniority Row */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        {t("employeeIdLabel")}
                      </label>
                      <input
                        type="text"
                        value={formData.employee_id}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            employee_id: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        placeholder="e.g., 47554"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Seniority
                      </label>
                      <input
                        type="text"
                        value={formData.seniority}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            seniority: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        placeholder="e.g., 3Y-283.95D"
                      />
                    </div>
                  </div>

                  {/* Employment Type & Hours Row */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        {t("employmentType")}
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setFormData({
                              ...formData,
                              employment_type: "full-time",
                              max_weekly_hours: fullTimeBiWeeklyTarget,
                            })
                          }
                          className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                            formData.employment_type === "full-time"
                              ? "bg-blue-600 text-white"
                              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                        >
                          {t("fullTime")}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setFormData({
                              ...formData,
                              employment_type: "part-time",
                              max_weekly_hours: partTimeBiWeeklyTarget,
                            })
                          }
                          className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                            formData.employment_type === "part-time"
                              ? "bg-purple-600 text-white"
                              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                        >
                          {t("partTime")}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        {t("hoursPerBiweekly")}
                      </label>
                      <input
                        type="number"
                        required
                        min="0"
                        max="168"
                        step="0.25"
                        value={formData.max_weekly_hours}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            max_weekly_hours:
                              parseFloat(e.target.value.replace(",", ".")) || 0,
                          })
                        }
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>
                  </div>

                  {/* Certifications */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      {t("certifications")}
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label
                        className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                          formData.is_chemo_certified
                            ? "border-green-500 bg-green-50"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.is_chemo_certified}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              is_chemo_certified: e.target.checked,
                            })
                          }
                          className="sr-only"
                        />
                        <span className="text-xl">💉</span>
                        <span className="text-sm font-medium text-gray-700">
                          {t("chemo")}
                        </span>
                        {formData.is_chemo_certified && (
                          <svg
                            className="w-5 h-5 text-green-500 ml-auto"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </label>

                      <label
                        className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                          formData.is_transplant_certified
                            ? "border-purple-500 bg-purple-50"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.is_transplant_certified}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              is_transplant_certified: e.target.checked,
                            })
                          }
                          className="sr-only"
                        />
                        <span className="text-xl">🫀</span>
                        <span className="text-sm font-medium text-gray-700">
                          {t("transplant")}
                        </span>
                        {formData.is_transplant_certified && (
                          <svg
                            className="w-5 h-5 text-purple-500 ml-auto"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </label>

                      <label
                        className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                          formData.is_renal_certified
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.is_renal_certified}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              is_renal_certified: e.target.checked,
                            })
                          }
                          className="sr-only"
                        />
                        <span className="text-xl">🩺</span>
                        <span className="text-sm font-medium text-gray-700">
                          {t("renal")}
                        </span>
                        {formData.is_renal_certified && (
                          <svg
                            className="w-5 h-5 text-blue-500 ml-auto"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </label>

                      <label
                        className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                          formData.is_charge_certified
                            ? "border-amber-500 bg-amber-50"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.is_charge_certified}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              is_charge_certified: e.target.checked,
                            })
                          }
                          className="sr-only"
                        />
                        <span className="text-xl">⭐</span>
                        <span className="text-sm font-medium text-gray-700">
                          {t("charge")}
                        </span>
                        {formData.is_charge_certified && (
                          <svg
                            className="w-5 h-5 text-amber-500 ml-auto"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </label>
                    </div>
                  </div>

                  {/* Other Certifications */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      {t("otherCertifications")}
                    </label>
                    <input
                      type="text"
                      value={formData.other_certifications}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          other_certifications: e.target.value,
                        })
                      }
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      placeholder="e.g., ACLS, PALS, BLS"
                    />
                  </div>

                  {/* Leave Status */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      {t("leaveStatus")}
                    </label>
                    <p className="text-xs text-gray-500 mb-3">
                      {t("leaveNote")}
                    </p>
                    <div className="space-y-2">
                      <label
                        className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                          formData.is_on_maternity_leave
                            ? "border-pink-500 bg-pink-50"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.is_on_maternity_leave}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              is_on_maternity_leave: e.target.checked,
                            })
                          }
                          className="sr-only"
                        />
                        <span className="text-xl">👶</span>
                        <span className="text-sm font-medium text-gray-700">
                          {t("maternityLeave")}
                        </span>
                        {formData.is_on_maternity_leave && (
                          <svg
                            className="w-5 h-5 text-pink-500 ml-auto"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </label>

                      <label
                        className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                          formData.is_on_sick_leave
                            ? "border-red-500 bg-red-50"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.is_on_sick_leave}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              is_on_sick_leave: e.target.checked,
                            })
                          }
                          className="sr-only"
                        />
                        <span className="text-xl">🏥</span>
                        <span className="text-sm font-medium text-gray-700">
                          {t("sickLeave")}
                        </span>
                        {formData.is_on_sick_leave && (
                          <svg
                            className="w-5 h-5 text-red-500 ml-auto"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </label>

                      <label
                        className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                          formData.is_on_sabbatical
                            ? "border-indigo-500 bg-indigo-50"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.is_on_sabbatical}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              is_on_sabbatical: e.target.checked,
                            })
                          }
                          className="sr-only"
                        />
                        <span className="text-xl">✈️</span>
                        <span className="text-sm font-medium text-gray-700">
                          {t("sabbaticalLeave")}
                        </span>
                        {formData.is_on_sabbatical && (
                          <svg
                            className="w-5 h-5 text-indigo-500 ml-auto"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </label>
                    </div>
                  </div>
                </form>
              </div>

              {/* Footer with buttons */}
              <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-6 py-3 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="nurse-form"
                  disabled={saving}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving && (
                    <svg
                      className="animate-spin h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  )}
                  {editingNurse ? t("saveChanges") : t("addStaffMember")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
