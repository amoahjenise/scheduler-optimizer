"use client";

import React, { useState } from "react";
import {
  Edit2,
  Check,
  X,
  AlertCircle,
  Save,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { createNurseAPI, NurseCreate } from "../lib/api";
import { useUser } from "@clerk/nextjs";
import { loadStaffingDefaults } from "./StaffRequirementsEditor";

interface Nurse {
  id: string;
  name: string;
  isChemoCertified: boolean;
  isTransplantCertified?: boolean;
  isRenalCertified?: boolean;
  isChargeCertified?: boolean;
  employmentType: string;
  maxWeeklyHours: number;
  offRequests: string[];
  seniority?: number;
  employeeId?: string;
}

interface ShiftRequirement {
  count: number;
  minChemoCertified: number;
  shiftCodes: string[];
}

interface Constraints {
  dateRange: { start: string; end: string };
  shiftRequirements: {
    dayShift: ShiftRequirement;
    nightShift: ShiftRequirement;
  };
  nurses: Nurse[];
  shiftsInfo: Record<string, any>;
  constraints: Record<string, any>;
}

interface Props {
  constraints: Constraints;
  onConfirm: (editedConstraints: Constraints) => void;
  onCancel: () => void;
  onEdit: () => void;
  fullTimeBiWeeklyTarget?: number;
  partTimeBiWeeklyTarget?: number;
}

export default function ConstraintsConfirmation({
  constraints: initialConstraints,
  onConfirm,
  onCancel,
  onEdit,
  fullTimeBiWeeklyTarget = 75,
  partTimeBiWeeklyTarget = 63.75,
}: Props) {
  const { user } = useUser();

  const parseLocalDate = (value: string) => {
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T00:00:00`
      : value;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const formatLocalDate = (value: string) => {
    const parsed = parseLocalDate(value);
    return parsed ? parsed.toLocaleDateString() : value;
  };

  // Remove case-insensitive duplicates from initial constraints
  const removeDuplicates = (nurses: Nurse[] | undefined | null): Nurse[] => {
    // Defensive check - if nurses is not an array, return empty array
    if (!Array.isArray(nurses)) {
      console.warn(
        "removeDuplicates: nurses is not an array, got:",
        typeof nurses,
      );
      return [];
    }
    const seen = new Map<string, Nurse>();
    nurses.forEach((nurse) => {
      if (nurse && nurse.name) {
        const key = nurse.name.toLowerCase().trim();
        if (!seen.has(key)) {
          seen.set(key, nurse);
        }
      }
    });
    return Array.from(seen.values());
  };

  const [constraints, setConstraints] = useState<Constraints>({
    ...initialConstraints,
    nurses: removeDuplicates(initialConstraints.nurses),
  });
  const [editingNurseId, setEditingNurseId] = useState<string | null>(null);
  const [savingNurses, setSavingNurses] = useState(false);
  const [savedNurseIds, setSavedNurseIds] = useState<Set<string>>(new Set());
  const [expandedNurses, setExpandedNurses] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<
    "overview" | "nurses" | "requirements"
  >("overview");

  // Per-category staffing requirements (07, 15, 19, 23)
  // Initialize from saved Settings page values (localStorage), falling back to defaults
  const [staffingCategories, setStaffingCategories] = useState<
    Record<string, number>
  >(() => {
    const saved = loadStaffingDefaults();
    return {
      "07": saved["07(G)"] ?? 5,
      "15": saved["15(G)"] ?? 5,
      "19": saved["19(G)"] ?? 4,
      "23": saved["23(G)"] ?? 4,
    };
  });

  const handleCategoryChange = (category: string, value: number) => {
    const updated = { ...staffingCategories, [category]: value };
    setStaffingCategories(updated);
    // Sync back to constraints: day = min of day categories, night = min of night categories
    const dayMin = Math.min(updated["07"] ?? 5, updated["15"] ?? 5);
    const nightMin = Math.min(updated["19"] ?? 4, updated["23"] ?? 4);
    setConstraints({
      ...constraints,
      shiftRequirements: {
        ...constraints.shiftRequirements,
        dayShift: { ...constraints.shiftRequirements.dayShift, count: dayMin },
        nightShift: {
          ...constraints.shiftRequirements.nightShift,
          count: nightMin,
        },
      },
    });
  };

  const handleDayCountChange = (value: number) => {
    setConstraints({
      ...constraints,
      shiftRequirements: {
        ...constraints.shiftRequirements,
        dayShift: { ...constraints.shiftRequirements.dayShift, count: value },
      },
    });
  };

  const handleNightCountChange = (value: number) => {
    setConstraints({
      ...constraints,
      shiftRequirements: {
        ...constraints.shiftRequirements,
        nightShift: {
          ...constraints.shiftRequirements.nightShift,
          count: value,
        },
      },
    });
  };

  const handleNurseUpdate = (index: number, field: keyof Nurse, value: any) => {
    const updatedNurses = [...constraints.nurses];
    updatedNurses[index] = { ...updatedNurses[index], [field]: value };
    setConstraints({ ...constraints, nurses: updatedNurses });
  };

  const handleRemoveNurse = (index: number) => {
    const updatedNurses = constraints.nurses.filter((_, i) => i !== index);
    setConstraints({ ...constraints, nurses: updatedNurses });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <AlertCircle className="w-6 h-6" />
                Review Constraints
              </h2>
              <p className="text-blue-100 mt-1">
                AI has parsed the following constraints. Review and edit before
                optimizing.
              </p>
            </div>
            <button
              onClick={onCancel}
              className="text-white/80 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 bg-gray-50 px-6">
          <div className="flex gap-4">
            {[
              { key: "overview", label: "Overview" },
              { key: "nurses", label: `Nurses (${constraints.nurses.length})` },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Date Range */}
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                <h3 className="font-semibold text-blue-900 mb-2">
                  Schedule Period
                </h3>
                {(() => {
                  const start = parseLocalDate(constraints.dateRange.start);
                  const end = parseLocalDate(constraints.dateRange.end);
                  const dayCount =
                    start && end
                      ? Math.floor(
                          (end.getTime() - start.getTime()) /
                            (1000 * 60 * 60 * 24),
                        ) + 1
                      : 0;

                  return (
                    <p className="text-blue-700">
                      {formatLocalDate(constraints.dateRange.start)} →{" "}
                      {formatLocalDate(constraints.dateRange.end)}
                      <span className="ml-2 text-sm">({dayCount} days)</span>
                    </p>
                  );
                })()}
              </div>

              {/* Minimum Staff Requirements - Per-Category Editable */}
              <div className="bg-white rounded-lg p-4 border border-gray-200">
                <h3 className="font-semibold text-gray-900 mb-3">
                  👥 Staffing Requirements (minimum per shift)
                </h3>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    {
                      key: "07",
                      label: "07:00",
                      icon: "☀️",
                      desc: "Day (07, Z07)",
                      color: "amber",
                    },
                    {
                      key: "15",
                      label: "15:00",
                      icon: "🌅",
                      desc: "Eve (E15)",
                      color: "orange",
                    },
                    {
                      key: "19",
                      label: "19:00",
                      icon: "🌙",
                      desc: "Night (Z19)",
                      color: "indigo",
                    },
                    {
                      key: "23",
                      label: "23:00",
                      icon: "🌑",
                      desc: "Night (23, Z23)",
                      color: "purple",
                    },
                  ].map(({ key, label, icon, desc, color }) => (
                    <div
                      key={key}
                      className={`bg-${color}-50 rounded-lg p-3 border border-${color}-200`}
                    >
                      <p className="text-xs font-medium text-gray-600 mb-1">
                        {icon} {label}
                      </p>
                      <input
                        type="number"
                        value={staffingCategories[key] ?? 5}
                        onChange={(e) =>
                          handleCategoryChange(
                            key,
                            parseInt(e.target.value) || 1,
                          )
                        }
                        className={`w-full px-2 py-1.5 text-xl font-bold text-${color}-600 bg-white border border-${color}-300 rounded-lg focus:ring-2 focus:ring-${color}-500 text-center`}
                        min={1}
                      />
                      <p className="text-xs text-gray-500 mt-1 text-center">
                        {desc}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Day minimum:{" "}
                  {Math.min(
                    staffingCategories["07"] ?? 5,
                    staffingCategories["15"] ?? 5,
                  )}{" "}
                  • Night minimum:{" "}
                  {Math.min(
                    staffingCategories["19"] ?? 4,
                    staffingCategories["23"] ?? 4,
                  )}
                </p>
              </div>

              {/* Nurses Summary */}
              <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                <h3 className="font-semibold text-green-900 mb-2">
                  Staff Overview
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-green-700">Total Nurses</p>
                    <p className="text-2xl font-bold text-green-600">
                      {constraints.nurses.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-green-700">Chemo Certified</p>
                    <p className="text-2xl font-bold text-green-600">
                      {
                        constraints.nurses.filter((n) => n.isChemoCertified)
                          .length
                      }
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-green-700">With Off Requests</p>
                    <p className="text-2xl font-bold text-green-600">
                      {
                        constraints.nurses.filter(
                          (n) => n.offRequests?.length > 0,
                        ).length
                      }
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-green-700">Renal Certified</p>
                    <p className="text-2xl font-bold text-green-600">
                      {
                        constraints.nurses.filter((n) => n.isRenalCertified)
                          .length
                      }
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-green-700">
                      Transplant Certified
                    </p>
                    <p className="text-2xl font-bold text-green-600">
                      {
                        constraints.nurses.filter(
                          (n) => n.isTransplantCertified,
                        ).length
                      }
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-green-700">Charge Certified</p>
                    <p className="text-2xl font-bold text-green-600">
                      {
                        constraints.nurses.filter((n) => n.isChargeCertified)
                          .length
                      }
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "nurses" && (
            <div className="space-y-3">
              {/* Save All to DB Button */}
              <div className="flex items-center justify-between mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div>
                  <p className="text-sm font-medium text-blue-900">
                    Save nurses to your database
                  </p>
                  <p className="text-xs text-blue-700">
                    Click to save all {constraints.nurses.length} nurses for
                    future schedules
                  </p>
                </div>
                <button
                  onClick={async () => {
                    if (!user?.id) {
                      alert("Please sign in to save nurses");
                      return;
                    }
                    setSavingNurses(true);
                    const userId = user.id;
                    let savedCount = 0;
                    for (const nurse of constraints.nurses) {
                      if (savedNurseIds.has(nurse.id)) continue;
                      try {
                        const employmentType =
                          nurse.employmentType === "part-time"
                            ? "part-time"
                            : "full-time";
                        const resolvedMaxWeeklyHours =
                          nurse.maxWeeklyHours ||
                          (employmentType === "part-time"
                            ? partTimeBiWeeklyTarget
                            : fullTimeBiWeeklyTarget);
                        const resolvedTargetWeeklyHours =
                          employmentType === "part-time" &&
                          resolvedMaxWeeklyHours > 0 &&
                          resolvedMaxWeeklyHours <= 60
                            ? resolvedMaxWeeklyHours
                            : employmentType === "part-time"
                              ? partTimeBiWeeklyTarget
                              : fullTimeBiWeeklyTarget;

                        const nurseData: NurseCreate = {
                          name: nurse.name,
                          employee_id: nurse.employeeId,
                          employment_type: employmentType,
                          max_weekly_hours: resolvedMaxWeeklyHours,
                          target_weekly_hours: resolvedTargetWeeklyHours,
                          preferred_shift_length_hours: 11.25,
                          is_chemo_certified: nurse.isChemoCertified || false,
                          is_transplant_certified:
                            nurse.isTransplantCertified || false,
                          is_renal_certified: nurse.isRenalCertified || false,
                          is_charge_certified: nurse.isChargeCertified || false,
                        };
                        await createNurseAPI(userId, nurseData);
                        setSavedNurseIds(
                          (prev) => new Set([...prev, nurse.id]),
                        );
                        savedCount++;
                      } catch (err) {
                        // Nurse might already exist, skip
                        console.warn(
                          `Failed to save nurse ${nurse.name}:`,
                          err,
                        );
                      }
                    }
                    setSavingNurses(false);
                    alert(`Saved ${savedCount} new nurses to database`);
                  }}
                  disabled={savingNurses}
                  className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {savingNurses ? "Saving..." : "Save All to DB"}
                </button>
              </div>

              {constraints.nurses.map((nurse, idx) => {
                const isExpanded = expandedNurses.has(nurse.id);
                const isEditing = editingNurseId === nurse.id;

                return (
                  <div
                    key={nurse.id || idx}
                    className={`border rounded-lg transition-colors ${savedNurseIds.has(nurse.id) ? "border-green-300 bg-green-50" : "border-gray-200 hover:border-blue-300"}`}
                  >
                    {/* Collapsed View */}
                    <div
                      className="p-4 cursor-pointer flex items-start justify-between"
                      onClick={() => {
                        if (!isEditing) {
                          setExpandedNurses((prev) => {
                            const next = new Set(prev);
                            if (next.has(nurse.id)) next.delete(nurse.id);
                            else next.add(nurse.id);
                            return next;
                          });
                        }
                      }}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {isEditing ? (
                            <input
                              type="text"
                              value={nurse.name}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                handleNurseUpdate(idx, "name", e.target.value)
                              }
                              className="font-semibold text-gray-900 px-2 py-1 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500"
                            />
                          ) : (
                            <h4 className="font-semibold text-gray-900">
                              {nurse.name}
                            </h4>
                          )}
                          {nurse.isChemoCertified && (
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                              💉 Chemo
                            </span>
                          )}
                          {nurse.isTransplantCertified && (
                            <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">
                              🫀 Transplant
                            </span>
                          )}
                          {nurse.isRenalCertified && (
                            <span className="px-2 py-0.5 bg-teal-100 text-teal-700 text-xs rounded-full">
                              🩺 Renal
                            </span>
                          )}
                          {nurse.isChargeCertified && (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                              👨‍⚕️ Charge
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                              nurse.employmentType === "part-time"
                                ? "bg-amber-100 text-amber-800 border border-amber-200"
                                : "bg-sky-100 text-sky-800 border border-sky-200"
                            }`}
                          >
                            {nurse.employmentType === "part-time"
                              ? "PT • Part-Time"
                              : "FT • Full-Time"}
                          </span>
                          {savedNurseIds.has(nurse.id) && (
                            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                              ✓ Saved
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex items-center gap-4 text-sm text-gray-600">
                          <span>Max: {nurse.maxWeeklyHours}h/2wk</span>
                          {nurse.offRequests &&
                            nurse.offRequests.length > 0 && (
                              <span className="text-orange-600">
                                {nurse.offRequests.length} off request(s)
                              </span>
                            )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isEditing) {
                              setEditingNurseId(null);
                            } else {
                              setEditingNurseId(nurse.id);
                              setExpandedNurses(
                                (prev) => new Set([...prev, nurse.id]),
                              );
                            }
                          }}
                          className={`p-1.5 rounded transition-colors ${isEditing ? "bg-blue-100 text-blue-600" : "text-gray-400 hover:text-blue-600 hover:bg-blue-50"}`}
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              confirm(`Remove ${nurse.name} from the schedule?`)
                            ) {
                              handleRemoveNurse(idx);
                            }
                          }}
                          className="p-1.5 rounded transition-colors text-gray-400 hover:text-red-600 hover:bg-red-50"
                          title="Remove"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        {isExpanded ? (
                          <ChevronUp className="w-5 h-5 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                    </div>

                    {/* Expanded Edit View */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-gray-100 pt-4 space-y-3">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Employee ID
                            </label>
                            <input
                              type="text"
                              value={nurse.employeeId || ""}
                              onChange={(e) =>
                                handleNurseUpdate(
                                  idx,
                                  "employeeId",
                                  e.target.value,
                                )
                              }
                              disabled={!isEditing}
                              placeholder="Enter employee ID"
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Employment Type
                            </label>
                            <select
                              value={nurse.employmentType}
                              onChange={(e) => {
                                handleNurseUpdate(
                                  idx,
                                  "employmentType",
                                  e.target.value,
                                );
                                // Auto-populate maxWeeklyHours when changing to part-time
                                if (
                                  e.target.value === "part-time" &&
                                  nurse.maxWeeklyHours ===
                                    fullTimeBiWeeklyTarget
                                ) {
                                  handleNurseUpdate(
                                    idx,
                                    "maxWeeklyHours",
                                    partTimeBiWeeklyTarget,
                                  );
                                } else if (
                                  e.target.value === "full-time" &&
                                  nurse.maxWeeklyHours ===
                                    partTimeBiWeeklyTarget
                                ) {
                                  handleNurseUpdate(
                                    idx,
                                    "maxWeeklyHours",
                                    fullTimeBiWeeklyTarget,
                                  );
                                }
                              }}
                              disabled={!isEditing}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                            >
                              <option value="full-time">Full Time</option>
                              <option value="part-time">Part Time</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Max Weekly Hours
                            </label>
                            <input
                              type="number"
                              value={nurse.maxWeeklyHours}
                              onChange={(e) =>
                                handleNurseUpdate(
                                  idx,
                                  "maxWeeklyHours",
                                  parseFloat(e.target.value) || 0,
                                )
                              }
                              disabled={!isEditing}
                              min={0}
                              max={80}
                              step={0.25}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Certifications
                            </label>
                            <div className="space-y-1">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={!!nurse.isChemoCertified}
                                  onChange={(e) =>
                                    handleNurseUpdate(
                                      idx,
                                      "isChemoCertified",
                                      e.target.checked,
                                    )
                                  }
                                  disabled={!isEditing}
                                  className="rounded border-gray-300"
                                />
                                <span className="text-sm text-gray-700">
                                  Chemo Certified
                                </span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={!!nurse.isTransplantCertified}
                                  onChange={(e) =>
                                    handleNurseUpdate(
                                      idx,
                                      "isTransplantCertified",
                                      e.target.checked,
                                    )
                                  }
                                  disabled={!isEditing}
                                  className="rounded border-gray-300"
                                />
                                <span className="text-sm text-gray-700">
                                  Transplant Certified
                                </span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={!!nurse.isRenalCertified}
                                  onChange={(e) =>
                                    handleNurseUpdate(
                                      idx,
                                      "isRenalCertified",
                                      e.target.checked,
                                    )
                                  }
                                  disabled={!isEditing}
                                  className="rounded border-gray-300"
                                />
                                <span className="text-sm text-gray-700">
                                  Renal Certified
                                </span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={!!nurse.isChargeCertified}
                                  onChange={(e) =>
                                    handleNurseUpdate(
                                      idx,
                                      "isChargeCertified",
                                      e.target.checked,
                                    )
                                  }
                                  disabled={!isEditing}
                                  className="rounded border-gray-300"
                                />
                                <span className="text-sm text-gray-700">
                                  Charge Certified
                                </span>
                              </label>
                            </div>
                          </div>
                        </div>
                        {nurse.offRequests && nurse.offRequests.length > 0 && (
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Off Requests
                            </label>
                            <div className="flex flex-wrap gap-1">
                              {nurse.offRequests.map((date, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded"
                                >
                                  {date}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {isEditing && (
                          <div className="flex justify-end pt-2">
                            <button
                              onClick={() => setEditingNurseId(null)}
                              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                            >
                              <Check className="w-4 h-4" />
                              Done Editing
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 bg-gray-50 p-6">
          <div className="flex items-center justify-between">
            <button
              onClick={onCancel}
              className="px-6 py-2 text-gray-600 font-medium hover:text-gray-900 transition-colors"
            >
              ← Go Back
            </button>
            <button
              onClick={() => onConfirm(constraints)}
              className="px-8 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all flex items-center gap-2 shadow-lg"
            >
              <Check className="w-5 h-5" />
              Confirm & Optimize
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
