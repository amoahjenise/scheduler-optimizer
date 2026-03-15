"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Stethoscope, Eye, EyeOff, Lock, Pencil } from "lucide-react";
import SectionCard from "./SectionCard";
import {
  fetchSystemPromptsAPI,
  saveSystemPromptAPI,
  resetSystemPromptAPI,
} from "@/app/lib/api";

/* ------------------------------------------------------------------ */
/* Zone splitting – The prompt is divided into alternating zones:      */
/*   Zone 0 (editable): Start → before "SHIFT CODES REFERENCE"       */
/*   Zone 1 (locked):   "SHIFT CODES REFERENCE" → before "Processing"*/
/*   Zone 2 (editable): "Processing Instructions:" → before "Input"  */
/*   Zone 3 (locked):   "Input Data:" → end                          */
/* ------------------------------------------------------------------ */

const ZONE_BOUNDARIES = [
  "SHIFT CODES REFERENCE",
  "Processing Instructions:",
  "Input Data:",
];

interface PromptZone {
  text: string;
  locked: boolean;
  label: string;
}

function splitPromptIntoZones(raw: string): PromptZone[] {
  const zones: PromptZone[] = [];
  let remaining = raw;

  // Zone 0 – editable instructions
  const idx0 = remaining.indexOf(ZONE_BOUNDARIES[0]);
  if (idx0 === -1) {
    // Could not find shift codes section – treat entire prompt as editable
    return [{ text: remaining, locked: false, label: "Instructions" }];
  }
  zones.push({
    text: remaining.slice(0, idx0),
    locked: false,
    label: "Rules & Instructions",
  });
  remaining = remaining.slice(idx0);

  // Zone 1 – locked structure (shift codes + JSON structure)
  const idx1 = remaining.indexOf(ZONE_BOUNDARIES[1]);
  if (idx1 === -1) {
    zones.push({
      text: remaining,
      locked: true,
      label: "Shift Codes & JSON Structure",
    });
    return zones;
  }
  zones.push({
    text: remaining.slice(0, idx1),
    locked: true,
    label: "Shift Codes & JSON Structure",
  });
  remaining = remaining.slice(idx1);

  // Zone 2 – editable processing instructions
  const idx2 = remaining.indexOf(ZONE_BOUNDARIES[2]);
  if (idx2 === -1) {
    zones.push({
      text: remaining,
      locked: false,
      label: "Processing Instructions",
    });
    return zones;
  }
  zones.push({
    text: remaining.slice(0, idx2),
    locked: false,
    label: "Processing Instructions",
  });
  remaining = remaining.slice(idx2);

  // Zone 3 – locked footer
  zones.push({
    text: remaining,
    locked: true,
    label: "Input Data & Output Rules",
  });

  return zones;
}

function joinZones(zones: PromptZone[]): string {
  return zones.map((z) => z.text).join("");
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export default function SystemPrompt() {
  const [zones, setZones] = useState<PromptZone[]>([]);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [collapsedLocked, setCollapsedLocked] = useState<Set<number>>(
    new Set(),
  );

  const originalZones = useRef<PromptZone[]>([]);

  const requiredPlaceholders = [
    "{start_date}",
    "{end_date}",
    "{nurses_list}",
    "{notes}",
    "{comments_json}",
    "{existing_assignments}",
  ];

  /* ---- Load ---- */
  useEffect(() => {
    async function loadPrompt() {
      setLoadingPrompt(true);
      setPromptError(null);
      try {
        const data = await fetchSystemPromptsAPI();
        const prompt = Array.isArray(data)
          ? data.find((p: any) => p?.name === "global")?.content ||
            data[0]?.content ||
            ""
          : data?.content || "";
        const parsed = splitPromptIntoZones(prompt);
        setZones(parsed);
        originalZones.current = parsed.map((z) => ({ ...z }));
        setHasChanges(false);
        setIsEditing(false);
      } catch (error: any) {
        setPromptError(error.message || "Failed to load system prompt");
      } finally {
        setLoadingPrompt(false);
      }
    }
    loadPrompt();
  }, []);

  /* ---- Editable zone change ---- */
  const onZoneChange = useCallback(
    (index: number, value: string) => {
      setZones((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], text: value };
        // Check for changes against original
        const changed = updated.some(
          (z, i) => z.text !== originalZones.current[i]?.text,
        );
        setHasChanges(changed);
        return updated;
      });
      if (promptError) setPromptError(null);
    },
    [promptError],
  );

  /* ---- Validation ---- */
  function validateBeforeSave(fullText: string) {
    const missing = requiredPlaceholders.filter((ph) => !fullText.includes(ph));
    if (missing.length > 0) {
      return `Missing required placeholders: ${missing.join(", ")}`;
    }
    return null;
  }

  /* ---- Save ---- */
  async function savePrompt() {
    setSavingPrompt(true);
    setPromptError(null);
    const fullText = joinZones(zones);
    const error = validateBeforeSave(fullText);
    if (error) {
      setPromptError(error);
      setSavingPrompt(false);
      return;
    }
    try {
      await saveSystemPromptAPI("global", fullText);
      alert("System prompt saved!");
      originalZones.current = zones.map((z) => ({ ...z }));
      setHasChanges(false);
      setIsEditing(false);
    } catch (error: any) {
      setPromptError(error.message || "Failed to save system prompt");
    } finally {
      setSavingPrompt(false);
    }
  }

  /* ---- Cancel ---- */
  function cancelEditing() {
    setZones(originalZones.current.map((z) => ({ ...z })));
    setHasChanges(false);
    setPromptError(null);
    setIsEditing(false);
  }

  /* ---- Reset ---- */
  async function resetPrompt() {
    if (
      !confirm(
        "Are you sure you want to reset the system prompt to default? All your customizations will be lost.",
      )
    )
      return;

    setLoadingPrompt(true);
    setPromptError(null);
    try {
      const data = await resetSystemPromptAPI();
      const prompt = data.content || "";
      const parsed = splitPromptIntoZones(prompt);
      setZones(parsed);
      originalZones.current = parsed.map((z) => ({ ...z }));
      alert("System prompt reset to default!");
      setHasChanges(false);
      setIsEditing(false);
    } catch (error: any) {
      setPromptError(error.message || "Failed to reset system prompt");
    } finally {
      setLoadingPrompt(false);
    }
  }

  /* ---- Toggle locked collapse ---- */
  function toggleLockedCollapse(idx: number) {
    setCollapsedLocked((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  /* ---- Render ---- */
  return (
    <SectionCard
      title="System Prompt"
      icon={<Stethoscope className="text-sky-600" />}
      className="w-full"
    >
      {loadingPrompt ? (
        <p>Loading prompt...</p>
      ) : (
        <>
          {promptError && <p className="text-red-600 mb-2">{promptError}</p>}

          <p className="mb-3 text-gray-700 text-sm">
            Edit the system prompt that guides the optimizer.{" "}
            <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
              <Lock size={12} /> Locked
            </span>{" "}
            sections are auto-generated from your shift codes and cannot be
            edited.{" "}
            <span className="inline-flex items-center gap-1 text-blue-700 font-medium">
              <Pencil size={12} /> Editable
            </span>{" "}
            sections can be customized.
          </p>

          {isEditing ? (
            <div className="space-y-3">
              {zones.map((zone, idx) =>
                zone.locked ? (
                  /* ---------- Locked zone ---------- */
                  <div
                    key={idx}
                    className="border border-amber-300 rounded-md bg-amber-50 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleLockedCollapse(idx)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 transition"
                    >
                      <span className="flex items-center gap-1.5">
                        <Lock size={14} /> {zone.label}
                      </span>
                      <span className="text-xs text-amber-600">
                        {collapsedLocked.has(idx) ? "▶ Show" : "▼ Collapse"}
                      </span>
                    </button>
                    {!collapsedLocked.has(idx) && (
                      <pre className="whitespace-pre-wrap px-3 py-2 text-xs font-mono text-gray-700 max-h-[240px] overflow-auto select-none">
                        {zone.text}
                      </pre>
                    )}
                  </div>
                ) : (
                  /* ---------- Editable zone ---------- */
                  <div key={idx}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Pencil size={14} className="text-blue-600" />
                      <span className="text-sm font-semibold text-blue-800">
                        {zone.label}
                      </span>
                    </div>
                    <textarea
                      value={zone.text}
                      onChange={(e) => onZoneChange(idx, e.target.value)}
                      rows={Math.min(
                        16,
                        Math.max(4, zone.text.split("\n").length + 1),
                      )}
                      className="w-full border border-blue-300 rounded-md p-3 resize-y focus:outline-none focus:ring-2 focus:ring-sky-400 font-mono text-sm"
                      spellCheck={false}
                    />
                  </div>
                ),
              )}
            </div>
          ) : (
            /* ---------- Read-only preview ---------- */
            <div className="relative">
              <pre
                className={`whitespace-pre-wrap p-4 border border-blue-300 rounded-md bg-gray-50 text-gray-800 font-mono text-sm transition-all duration-300 ${
                  showFullPreview
                    ? "max-h-[600px] overflow-auto"
                    : "max-h-[160px] overflow-hidden"
                }`}
              >
                {joinZones(zones)}
              </pre>
              <button
                onClick={() => setShowFullPreview((prev) => !prev)}
                className="text-sm text-blue-600 hover:underline mt-2 flex items-center gap-1"
              >
                {showFullPreview ? (
                  <>
                    <EyeOff size={16} /> Hide Preview
                  </>
                ) : (
                  <>
                    <Eye size={16} /> Show Full Preview
                  </>
                )}
              </button>
            </div>
          )}

          {/* ---- Action buttons ---- */}
          <div className="flex gap-2 mt-4">
            {isEditing ? (
              <>
                <button
                  onClick={savePrompt}
                  disabled={savingPrompt || !hasChanges}
                  className={`px-4 py-2 rounded-md font-medium text-white ${
                    savingPrompt || !hasChanges
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-green-600 hover:bg-green-700"
                  }`}
                >
                  {savingPrompt ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={cancelEditing}
                  disabled={savingPrompt}
                  className="px-4 py-2 rounded-md font-medium bg-gray-300 hover:bg-gray-400"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 rounded-md font-medium text-white bg-blue-600 hover:bg-blue-700"
              >
                Edit
              </button>
            )}

            <button
              onClick={resetPrompt}
              disabled={loadingPrompt || savingPrompt}
              className={`px-4 py-2 rounded-md font-medium text-white ${
                loadingPrompt
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {loadingPrompt ? "Resetting..." : "Reset to Default"}
            </button>
          </div>
        </>
      )}
    </SectionCard>
  );
}
