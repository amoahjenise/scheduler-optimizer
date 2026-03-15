/**
 * ScheduleTemplateManager — UI for saving, loading, and managing schedule templates.
 *
 * Two modes:
 *   1. SaveDialog — shown on the result step after finalization
 *   2. LoadPicker — shown on the setup step to start from a template
 */

"use client";

import React, { useState } from "react";
import {
  Save,
  FolderOpen,
  Trash2,
  X,
  Clock,
  Users,
  CalendarDays,
  FileDown,
} from "lucide-react";
import type { ScheduleTemplate } from "../hooks/useScheduleTemplates";
import type { GridRow } from "../types";

// ============================================================================
// SAVE TEMPLATE DIALOG
// ============================================================================

interface SaveTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, notes?: string) => void;
  defaultName?: string;
}

export function SaveTemplateDialog({
  open,
  onClose,
  onSave,
  defaultName = "",
}: SaveTemplateDialogProps) {
  const [name, setName] = useState(defaultName);
  const [notes, setNotes] = useState("");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Save className="w-5 h-5 text-blue-600" />
            Save as Template
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          <p className="text-sm text-gray-500">
            Save this schedule as a reusable template. Next time you create a
            schedule, you can start from this pattern instead of from scratch.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Template Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Heme-Onc 14-day rotation"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about this rotation pattern…"
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (name.trim()) {
                  onSave(name.trim(), notes.trim() || undefined);
                  onClose();
                }
              }}
              disabled={!name.trim()}
              className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              Save Template
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// LOAD TEMPLATE PICKER (used in setup step)
// ============================================================================

interface TemplatePickerProps {
  templates: ScheduleTemplate[];
  onSelect: (templateId: string) => void;
  onDelete: (templateId: string) => void;
}

export function TemplatePicker({
  templates,
  onSelect,
  onDelete,
}: TemplatePickerProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (templates.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <FolderOpen className="w-10 h-10 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No saved templates yet</p>
        <p className="text-xs mt-1">
          Finalize a schedule, then save it as a template to reuse later.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {templates.map((tpl) => {
        const age = formatAge(tpl.createdAt);
        return (
          <div
            key={tpl.id}
            className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/30 transition-colors group"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">
                {tpl.name}
              </p>
              <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {tpl.nurses.length} nurse{tpl.nurses.length !== 1 ? "s" : ""}
                </span>
                <span className="flex items-center gap-1">
                  <CalendarDays className="w-3 h-3" />
                  {tpl.periodDays} days
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {age}
                </span>
              </div>
              {tpl.notes && (
                <p className="text-xs text-gray-400 mt-1 truncate">
                  {tpl.notes}
                </p>
              )}
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => onSelect(tpl.id)}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 flex items-center gap-1"
              >
                <FileDown className="w-3.5 h-3.5" />
                Use
              </button>
              {confirmDeleteId === tpl.id ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      onDelete(tpl.id);
                      setConfirmDeleteId(null);
                    }}
                    className="px-2 py-1.5 text-xs text-red-700 bg-red-50 rounded-lg hover:bg-red-100"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="px-2 py-1.5 text-xs text-gray-500 bg-gray-50 rounded-lg hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(tpl.id)}
                  className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete template"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function formatAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
