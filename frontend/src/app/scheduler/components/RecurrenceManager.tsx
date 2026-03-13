"use client";

import { useState, useEffect } from "react";
import { AlertCircle, Plus, Edit2, Trash2, Calendar, Zap } from "lucide-react";

interface Recurrence {
  id: number;
  name: string;
  description?: string;
  recurrence_type: string;
  pattern: Record<string, string[]>;
  cycle_length_days: number;
  applicable_nurses: string[];
  start_date?: string;
  end_date?: string;
  is_active: boolean;
  created_at: string;
}

interface RecurrenceManagerProps {
  orgId: string;
}

export function RecurrenceManager({ orgId }: RecurrenceManagerProps) {
  const [recurrences, setRecurrences] = useState<Recurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    recurrence_type: "weekly",
    cycle_length_days: 7,
    pattern: {} as Record<string, string[]>,
    start_date: "",
  });

  const days = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];
  const dayKeys = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];

  useEffect(() => {
    loadRecurrences();
  }, [orgId]);

  const loadRecurrences = async () => {
    try {
      setLoading(true);
      // TODO: Fetch from API
      // const response = await fetch(`/api/scheduling/recurrences?org_id=${orgId}`);
      // const data = await response.json();
      // setRecurrences(data);
      setRecurrences([]);
    } catch (err) {
      setError("Failed to load recurrences");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // TODO: Submit to API
      setShowForm(false);
      setFormData({
        name: "",
        description: "",
        recurrence_type: "weekly",
        cycle_length_days: 7,
        pattern: {},
        start_date: "",
      });
      await loadRecurrences();
    } catch (err) {
      setError("Failed to save recurrence");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this recurrence?")) return;
    try {
      // TODO: Call delete API
      await loadRecurrences();
    } catch (err) {
      setError("Failed to delete recurrence");
    }
  };

  const updatePatternDay = (day: string, shifts: string[]) => {
    setFormData({
      ...formData,
      pattern: {
        ...formData.pattern,
        [day]: shifts,
      },
    });
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-gray-500">
        Loading recurrences...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Zap className="w-6 h-6 text-emerald-600" />
            Rotating Schedules
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Create recurring schedule patterns to save time
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm(!showForm);
            setEditingId(null);
          }}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-2 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Pattern
        </button>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-900">{error}</p>
            <p className="text-sm text-red-700 mt-1">
              Please try again or contact support.
            </p>
          </div>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">
            Create Rotating Pattern
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Pattern Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="e.g., 2-week rotating nights"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Pattern Type
              </label>
              <select
                value={formData.recurrence_type}
                onChange={(e) =>
                  setFormData({ ...formData, recurrence_type: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="bi-weekly">Bi-Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder="Optional description of this pattern"
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>

          {/* Weekly Pattern Editor */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              Weekly Pattern
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {days.map((day, idx) => (
                <div key={day} className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">
                    {day}
                  </label>
                  <select
                    multiple
                    value={formData.pattern[dayKeys[idx]] || []}
                    onChange={(e) => {
                      const selected = Array.from(
                        e.target.selectedOptions,
                        (option) => option.value,
                      );
                      updatePatternDay(dayKeys[idx], selected);
                    }}
                    className="w-full px-2 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="OFF">OFF</option>
                    <option value="Z07">Morning (Z07)</option>
                    <option value="Z30">Afternoon (Z30)</option>
                    <option value="Z99">Night (Z99)</option>
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium transition-colors"
            >
              Save Pattern
            </button>
          </div>
        </div>
      )}

      {/* List of Recurrences */}
      <div className="grid grid-cols-1 gap-4">
        {recurrences.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
            <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">
              No rotating patterns yet
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Create your first pattern to get started
            </p>
          </div>
        ) : (
          recurrences.map((rec) => (
            <div
              key={rec.id}
              className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-gray-900">{rec.name}</h4>
                    <span
                      className={`px-2 py-1 text-xs rounded-full font-medium ${
                        rec.is_active
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {rec.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  {rec.description && (
                    <p className="text-sm text-gray-600 mt-1">
                      {rec.description}
                    </p>
                  )}
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    <span>Type: {rec.recurrence_type}</span>
                    <span>Cycle: {rec.cycle_length_days}d</span>
                    <span>Nurses: {rec.applicable_nurses.length}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingId(rec.id)}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(rec.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
