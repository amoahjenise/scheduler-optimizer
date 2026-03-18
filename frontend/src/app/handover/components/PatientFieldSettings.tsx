"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  PatientFieldConfig,
  FieldConfig,
  PATIENT_CONFIG_DEFAULTS,
  savePatientConfig,
} from "../../lib/patientConfig";
import {
  loadDiagnoses,
  saveDiagnoses,
  DEFAULT_DIAGNOSES,
} from "../../lib/diagnosesConfig";

interface PatientFieldSettingsProps {
  config: PatientFieldConfig;
  onSave: (config: PatientFieldConfig) => void;
  onClose: () => void;
}

const FIELD_META: {
  key: keyof PatientFieldConfig;
  description: string;
  canHide: boolean;
  canRequire: boolean;
}[] = [
  {
    key: "mrn",
    description: "Medical Record Number",
    canHide: true,
    canRequire: true,
  },
  {
    key: "date_of_birth",
    description: "Date of Birth / Age",
    canHide: true,
    canRequire: true,
  },
  {
    key: "diagnosis",
    description: "Diagnosis",
    canHide: true,
    canRequire: true,
  },
  {
    key: "attending_physician",
    description: "Attending Physician",
    canHide: true,
    canRequire: true,
  },
  { key: "team", description: "Team", canHide: true, canRequire: true },
  {
    key: "bed",
    description: "Bed (within room)",
    canHide: true,
    canRequire: false,
  },
  {
    key: "admission_date",
    description: "Admission Date",
    canHide: true,
    canRequire: false,
  },
  {
    key: "outgoing_nurse",
    description: "Outgoing Nurse (Giving Report)",
    canHide: true,
    canRequire: true,
  },
  {
    key: "incoming_nurse",
    description: "Incoming Nurse (Receiving Report)",
    canHide: true,
    canRequire: true,
  },
];

export default function PatientFieldSettings({
  config,
  onSave,
  onClose,
}: PatientFieldSettingsProps) {
  const t = useTranslations("handover");
  const [draft, setDraft] = useState<PatientFieldConfig>(() =>
    JSON.parse(JSON.stringify(config)),
  );
  const [diagDraft, setDiagDraft] = useState<string[]>(() => loadDiagnoses());
  const [newDiag, setNewDiag] = useState("");

  const update = (
    key: keyof PatientFieldConfig,
    patch: Partial<FieldConfig>,
  ) => {
    setDraft((prev) => {
      if (key === "reportMode") return prev; // Skip reportMode
      return {
        ...prev,
        [key]: { ...(prev[key] as FieldConfig), ...patch },
      };
    });
  };

  const handleSave = () => {
    savePatientConfig(draft);
    saveDiagnoses(diagDraft);
    // Dispatch custom event for same-window updates
    window.dispatchEvent(new Event("patientConfigChanged"));
    onSave(draft);
    onClose();
  };

  const handleReset = () => {
    setDraft(JSON.parse(JSON.stringify(PATIENT_CONFIG_DEFAULTS)));
    setDiagDraft([...DEFAULT_DIAGNOSES]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-blue-700 text-white">
          <div className="flex items-center gap-2">
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
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <span className="font-semibold text-base">
              {t("fieldSettingsTitle")}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-blue-800 rounded-lg transition-colors"
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
          {/* Hand-off Report Settings Section */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-1">
              {t("handoffReportSettingsTitle")}
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              {t("handoffReportSettingsDesc")}
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t("reportFrequency")}
            </label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="reportMode"
                  checked={draft.reportMode === "daily"}
                  onChange={() =>
                    setDraft((prev) => ({ ...prev, reportMode: "daily" }))
                  }
                  className="w-4 h-4 text-emerald-600"
                />
                <div>
                  <div className="text-sm font-medium text-gray-800">
                    {t("dailyReportTitle")}
                  </div>
                  <div className="text-xs text-gray-600">
                    {t("dailyReportDesc")}
                  </div>
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="reportMode"
                  checked={draft.reportMode === "shift"}
                  onChange={() =>
                    setDraft((prev) => ({ ...prev, reportMode: "shift" }))
                  }
                  className="w-4 h-4 text-emerald-600"
                />
                <div>
                  <div className="text-sm font-medium text-gray-800">
                    {t("shiftReportTitle")}
                  </div>
                  <div className="text-xs text-gray-600">
                    {t("shiftReportDesc")}
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[1fr,11rem,1fr,1fr] gap-3 px-2 pb-2 border-b border-gray-300 text-xs font-semibold text-gray-700 uppercase">
            <span>{t("fieldName")}</span>
            <span className="text-center">{t("visibilityRequired")}</span>
            <span>{t("displayLabel")}</span>
            <span>{t("infoTipHint")}</span>
          </div>

          {FIELD_META.map(({ key, description, canRequire }) => {
            const field = draft[key] as FieldConfig;
            return (
              <div
                key={key}
                className={`grid grid-cols-[1fr,11rem,1fr,1fr] gap-3 items-center px-2 py-2 rounded-md transition-colors ${
                  field.show ? "bg-white" : "bg-gray-50"
                }`}
              >
                {/* Description */}
                <div>
                  <div
                    className={`text-sm font-medium ${field.show ? "text-gray-800" : "text-gray-400"}`}
                  >
                    {description}
                  </div>
                </div>

                {/* Toggle columns with labels */}
                <div className="flex flex-col gap-2 w-44">
                  {/* Visible toggle */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-600 font-medium">
                      {t("visible")}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const newShow = !field.show;
                        update(key, {
                          show: newShow,
                          required: newShow ? field.required : false,
                        });
                      }}
                      className={`w-9 h-5 rounded-full transition-all relative flex-shrink-0 ${
                        field.show ? "bg-green-500" : "bg-gray-300"
                      }`}
                      title={field.show ? t("hideField") : t("showField")}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                          field.show ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Required toggle */}
                  <div className="flex items-center justify-between gap-2">
                    {canRequire ? (
                      <>
                        <span
                          className={`text-xs font-medium ${!field.show ? "text-gray-300" : "text-gray-600"}`}
                        >
                          {t("required")}
                        </span>
                        <button
                          type="button"
                          disabled={!field.show}
                          onClick={() =>
                            update(key, { required: !field.required })
                          }
                          className={`w-9 h-5 rounded-full transition-all relative flex-shrink-0 ${
                            !field.show
                              ? "bg-gray-200 cursor-not-allowed"
                              : field.required
                                ? "bg-red-500"
                                : "bg-gray-300"
                          }`}
                          title={
                            !field.show
                              ? t("enableFieldFirst")
                              : field.required
                                ? t("makeOptional")
                                : t("makeRequired")
                          }
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                              field.required ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">N/A</span>
                    )}
                  </div>
                </div>

                {/* Label input */}
                <div>
                  <input
                    type="text"
                    value={field.label}
                    disabled={!field.show}
                    onChange={(e) => update(key, { label: e.target.value })}
                    placeholder={description}
                    className={`w-full text-sm border rounded px-2 py-1.5 transition-all ${
                      field.show
                        ? "border-gray-300 bg-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        : "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                    }`}
                  />
                </div>

                {/* Info Tip input */}
                <div>
                  <input
                    type="text"
                    value={field.infoTip ?? ""}
                    onChange={(e) =>
                      update(key, { infoTip: e.target.value || undefined })
                    }
                    placeholder={t("infoTipPlaceholder")}
                    className="w-full text-sm border border-gray-300 bg-white rounded px-2 py-1.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            );
          })}

          {/* Diagnosis Suggestions Section */}
          <div className="mt-6 bg-purple-50 border border-purple-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-1">
              {t("diagnosisSuggestionsTitle")}
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              {t("diagnosisSuggestionsDesc")}
            </p>

            {/* Add new diagnosis */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={newDiag}
                onChange={(e) => setNewDiag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newDiag.trim()) {
                    e.preventDefault();
                    const trimmed = newDiag.trim();
                    if (
                      !diagDraft.some(
                        (d) => d.toLowerCase() === trimmed.toLowerCase(),
                      )
                    ) {
                      setDiagDraft((prev) => [...prev, trimmed]);
                    }
                    setNewDiag("");
                  }
                }}
                placeholder={t("addDiagnosisPlaceholder")}
                className="flex-1 text-sm border border-gray-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
              />
              <button
                type="button"
                disabled={!newDiag.trim()}
                onClick={() => {
                  const trimmed = newDiag.trim();
                  if (
                    trimmed &&
                    !diagDraft.some(
                      (d) => d.toLowerCase() === trimmed.toLowerCase(),
                    )
                  ) {
                    setDiagDraft((prev) => [...prev, trimmed]);
                  }
                  setNewDiag("");
                }}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white text-sm font-medium rounded transition-colors"
              >
                {t("add")}
              </button>
            </div>

            {/* Current list */}
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
              {diagDraft.map((diag) => (
                <span
                  key={diag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-purple-200 rounded-full text-xs text-gray-700"
                >
                  {diag}
                  <button
                    type="button"
                    onClick={() =>
                      setDiagDraft((prev) => prev.filter((d) => d !== diag))
                    }
                    className="ml-0.5 text-gray-400 hover:text-red-500 transition-colors"
                    title={t("remove")}
                  >
                    <svg
                      className="w-3 h-3"
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
                </span>
              ))}
            </div>

            {diagDraft.length === 0 && (
              <p className="text-xs text-gray-400 italic mt-1">
                {t("noDiagnosesConfigured")}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-800 font-medium hover:underline transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {t("resetToDefaults")}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg font-medium transition-colors"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors"
            >
              {t("saveChanges")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
