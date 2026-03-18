/**
 * useScheduleTemplates — Save / load finalized schedules as reusable templates.
 *
 * Templates are stored in localStorage under the key "scheduler-templates".
 * Each template captures the nurse roster, shift assignments, and period
 * metadata so the user can start a new period from an existing pattern.
 *
 * Template data:
 *   - name, createdAt, unit info
 *   - period length (days) — not the exact dates, since templates are reusable
 *   - roster: [{nurseName, employeeId, shifts: [{dayOffset, shiftCode, shiftType, hours}]}]
 */

import { useState, useCallback, useEffect } from "react";
import { GridRow, ShiftEntry } from "../types";

// ============================================================================
// TYPES
// ============================================================================

/** A single shift stored relative to the period start (day 0, 1, 2…) */
export interface TemplateShift {
  dayOffset: number; // 0-based day within the period
  shiftCode: string; // e.g., "Z07", "Z19", "C"
  shiftType: "day" | "night" | "combined" | "off";
  hours: number;
  startTime: string;
  endTime: string;
}

/** One nurse row inside a template */
export interface TemplateNurse {
  nurseName: string;
  employeeId?: string;
  seniority?: string;
  shifts: TemplateShift[];
}

/** A saved schedule template */
export interface ScheduleTemplate {
  id: string; // crypto.randomUUID()
  name: string;
  createdAt: string; // ISO timestamp
  periodDays: number; // 14, 28, 42, etc.
  nurses: TemplateNurse[];
  /** Optional metadata */
  unit?: string;
  notes?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STORAGE_KEY_PREFIX = "scheduler-templates";
const MAX_TEMPLATES = 20; // prevent localStorage bloat

/** Build a storage key scoped to an organization so templates never leak across orgs */
function getStorageKey(organizationId: string): string {
  return `${STORAGE_KEY_PREFIX}-${organizationId}`;
}

function normalizeTemplateName(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase();
}

// ============================================================================
// HELPERS
// ============================================================================

/** Generate a short human-friendly ID */
function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Read templates from localStorage scoped to an organization (safely) */
function loadTemplatesFromStorage(organizationId: string): ScheduleTemplate[] {
  try {
    const raw = localStorage.getItem(getStorageKey(organizationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ScheduleTemplate[];
  } catch {
    return [];
  }
}

/** Persist templates to localStorage scoped to an organization */
function saveTemplatesToStorage(
  organizationId: string,
  templates: ScheduleTemplate[],
): void {
  try {
    localStorage.setItem(
      getStorageKey(organizationId),
      JSON.stringify(templates),
    );
  } catch {
    console.warn("Failed to save templates to localStorage");
  }
}

/** Compute period length in days between two YYYY-MM-DD dates */
function daysBetween(start: string, end: string): number {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  return Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

/** Convert an absolute date to a 0-based day offset from a start date */
function dateToOffset(date: string, startDate: string): number {
  const d = new Date(date + "T00:00:00");
  const s = new Date(startDate + "T00:00:00");
  return Math.round((d.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
}

/** Convert a 0-based day offset back to YYYY-MM-DD given a start date */
function offsetToDate(offset: number, startDate: string): string {
  const s = new Date(startDate + "T00:00:00");
  const d = new Date(s.getTime() + offset * 24 * 60 * 60 * 1000);
  return d.toISOString().split("T")[0];
}

// ============================================================================
// CONVERSION: GridRow[] ↔ Template
// ============================================================================

/** Convert a finalized schedule (GridRow[]) into a template */
export function gridToTemplate(
  name: string,
  grid: GridRow[],
  startDate: string,
  endDate: string,
  unit?: string,
  notes?: string,
): ScheduleTemplate {
  const periodDays = daysBetween(startDate, endDate);

  const nurses: TemplateNurse[] = grid.map((row) => ({
    nurseName: row.nurse,
    employeeId: row.employeeId,
    seniority: row.seniority,
    shifts: row.shifts
      .filter((s) => s.date && s.shift)
      .map((s) => ({
        dayOffset: dateToOffset(s.date, startDate),
        shiftCode: s.shift,
        shiftType: s.shiftType,
        hours: s.hours,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
  }));

  return {
    id: generateId(),
    name,
    createdAt: new Date().toISOString(),
    periodDays,
    nurses,
    unit,
    notes,
  };
}

/** Apply a template onto a new date range → GridRow[] + date columns */
export function templateToGrid(
  template: ScheduleTemplate,
  newStartDate: string,
  newEndDate: string,
): { grid: GridRow[]; dates: string[] } {
  const newPeriodDays = daysBetween(newStartDate, newEndDate);

  // Generate date column array
  const dates: string[] = [];
  for (let d = 0; d < newPeriodDays; d++) {
    dates.push(offsetToDate(d, newStartDate));
  }

  const grid: GridRow[] = template.nurses.map((tn, idx) => {
    const shifts: ShiftEntry[] = tn.shifts
      .filter((ts) => ts.dayOffset >= 0 && ts.dayOffset < newPeriodDays)
      .map((ts) => ({
        date: offsetToDate(ts.dayOffset, newStartDate),
        shift: ts.shiftCode,
        shiftType: ts.shiftType,
        hours: ts.hours,
        startTime: ts.startTime,
        endTime: ts.endTime,
      }));

    return {
      id: `tpl-${idx}-${tn.nurseName.replace(/\s/g, "_")}`,
      nurse: tn.nurseName,
      employeeId: tn.employeeId,
      seniority: tn.seniority,
      shifts,
    };
  });

  return { grid, dates };
}

// ============================================================================
// HOOK
// ============================================================================

export function useScheduleTemplates(organizationId: string | null) {
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);

  // Reload templates whenever the active organization changes
  useEffect(() => {
    if (!organizationId) {
      setTemplates([]);
      return;
    }
    setTemplates(loadTemplatesFromStorage(organizationId));
  }, [organizationId]);

  /** Save a new template from a finalized schedule */
  const saveTemplate = useCallback(
    (
      name: string,
      grid: GridRow[],
      startDate: string,
      endDate: string,
      unit?: string,
      notes?: string,
    ): ScheduleTemplate | null => {
      if (!organizationId) {
        console.warn("Cannot save template: no active organization");
        return null;
      }

      const normalizedName = normalizeTemplateName(name);
      const existingTemplate = templates.find(
        (t) => normalizeTemplateName(t.name) === normalizedName,
      );

      if (existingTemplate) {
        const shouldOverwrite = window.confirm(
          `A template named "${existingTemplate.name}" already exists. Overwrite it?`,
        );
        if (!shouldOverwrite) {
          return null;
        }
      }

      const template = gridToTemplate(
        name,
        grid,
        startDate,
        endDate,
        unit,
        notes,
      );

      setTemplates((prev) => {
        let updated: ScheduleTemplate[];

        if (existingTemplate) {
          const overwritten: ScheduleTemplate = {
            ...template,
            id: existingTemplate.id,
          };
          updated = [
            overwritten,
            ...prev.filter((t) => t.id !== existingTemplate.id),
          ].slice(0, MAX_TEMPLATES);
        } else {
          updated = [template, ...prev].slice(0, MAX_TEMPLATES);
        }

        saveTemplatesToStorage(organizationId, updated);
        return updated;
      });

      return template;
    },
    [organizationId, templates],
  );

  /** Delete a template by ID */
  const deleteTemplate = useCallback(
    (id: string) => {
      if (!organizationId) return;
      setTemplates((prev) => {
        const updated = prev.filter((t) => t.id !== id);
        saveTemplatesToStorage(organizationId, updated);
        return updated;
      });
    },
    [organizationId],
  );

  /** Rename a template */
  const renameTemplate = useCallback(
    (id: string, newName: string) => {
      if (!organizationId) return;
      setTemplates((prev) => {
        const updated = prev.map((t) =>
          t.id === id ? { ...t, name: newName } : t,
        );
        saveTemplatesToStorage(organizationId, updated);
        return updated;
      });
    },
    [organizationId],
  );

  /** Load a template, projecting it onto new dates → GridRow[] + dates */
  const loadTemplate = useCallback(
    (
      templateId: string,
      newStartDate: string,
      newEndDate: string,
    ): { grid: GridRow[]; dates: string[] } | null => {
      const template = templates.find((t) => t.id === templateId);
      if (!template) return null;
      return templateToGrid(template, newStartDate, newEndDate);
    },
    [templates],
  );

  return {
    templates,
    saveTemplate,
    deleteTemplate,
    renameTemplate,
    loadTemplate,
  };
}
