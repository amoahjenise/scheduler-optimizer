"use client";

import React, { useState, useEffect } from "react";
import { listShiftTemplatesAPI, createShiftTemplateAPI } from "@/app/lib/api";

interface ShiftTemplate {
  id: string;
  name: string;
  template_type: "daily" | "weekly" | "monthly";
  description?: string;
  pattern: Record<string, string[]>;
  is_active: boolean;
}

export function ShiftTemplateManager({ orgId }: { orgId: string }) {
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [templateType, setTemplateType] = useState<
    "daily" | "weekly" | "monthly"
  >("weekly");
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState<Record<string, string[]>>({});

  useEffect(() => {
    async function loadTemplates() {
      setLoading(true);
      try {
        const data = await listShiftTemplatesAPI(orgId);
        setTemplates(data || []);
      } catch (error) {
        console.error("Failed to load templates:", error);
      } finally {
        setLoading(false);
      }
    }

    loadTemplates();
  }, [orgId]);

  const handleCreateTemplate = async () => {
    if (!name.trim()) {
      alert("Please enter a template name");
      return;
    }

    try {
      await createShiftTemplateAPI(orgId, {
        name,
        template_type: templateType,
        pattern,
      });

      // Reload templates
      const data = await listShiftTemplatesAPI(orgId);
      setTemplates(data || []);

      // Reset form
      setName("");
      setPattern({});
      setShowForm(false);
    } catch (error) {
      console.error("Failed to create template:", error);
      alert("Failed to create template");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Shift Templates
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Reusable scheduling patterns to speed up planning
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
        >
          + New Template
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Template Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Standard Weekly Rotation"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Type
            </label>
            <select
              value={templateType}
              onChange={(e) =>
                setTemplateType(
                  e.target.value as "daily" | "weekly" | "monthly",
                )
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCreateTemplate}
              className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
            >
              Create Template
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Templates List */}
      {loading ? (
        <div className="text-gray-500 text-center p-6">
          Loading templates...
        </div>
      ) : templates.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => (
            <div
              key={template.id}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h4 className="font-semibold text-gray-900">
                    {template.name}
                  </h4>
                  <p className="text-xs text-gray-600 mt-1 capitalize">
                    {template.template_type} Pattern
                  </p>
                </div>
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    template.is_active ? "bg-emerald-500" : "bg-gray-300"
                  }`}
                />
              </div>

              {template.description && (
                <p className="text-sm text-gray-600 mb-3">
                  {template.description}
                </p>
              )}

              <div className="bg-gray-50 rounded p-2 text-xs text-gray-700 font-mono mb-3 max-h-20 overflow-y-auto">
                {Object.entries(template.pattern).map(([day, shifts]) => (
                  <div key={day}>
                    Day {day}: {shifts.join(", ")}
                  </div>
                ))}
              </div>

              <button className="w-full px-3 py-2 text-sm text-emerald-600 hover:bg-emerald-50 rounded font-medium transition-colors border border-emerald-200">
                Use Template
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center p-6 bg-gray-50 rounded-lg text-gray-500">
          No templates created yet. Create one to speed up scheduling!
        </div>
      )}
    </div>
  );
}
