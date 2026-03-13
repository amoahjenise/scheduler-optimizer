"use client";

import React, { useState, useEffect } from "react";
import { getBalancingShiftsAPI } from "@/app/lib/api";

interface BalancingShift {
  nurse_id: string;
  nurse_name: string;
  hours_needed: number;
  recommended_date: string;
  delta: number;
  priority: "high" | "medium" | "low";
}

export function BalancingShiftsPanel({
  orgId,
  periodEndDate,
}: {
  orgId: string;
  periodEndDate: string;
}) {
  const [shifts, setShifts] = useState<BalancingShift[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadBalancingShifts() {
      setLoading(true);
      try {
        const data = await getBalancingShiftsAPI(orgId, periodEndDate);
        setShifts(data.recommendations || []);
      } catch (error) {
        console.error("Failed to load balancing shifts:", error);
      } finally {
        setLoading(false);
      }
    }

    loadBalancingShifts();
  }, [orgId, periodEndDate]);

  const priorityColors = {
    high: "bg-red-100 text-red-800 border-red-300",
    medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
    low: "bg-blue-100 text-blue-800 border-blue-300",
  };

  const priorityIcons = {
    high: "🔴",
    medium: "🟡",
    low: "🔵",
  };

  if (loading) {
    return <div className="text-gray-500 p-4">Loading balancing shifts...</div>;
  }

  if (shifts.length === 0) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 text-center">
        <div className="text-4xl mb-2">✓</div>
        <p className="font-medium text-emerald-900">
          All nurses are at target!
        </p>
        <p className="text-sm text-emerald-700 mt-1">
          No balancing shifts needed for this period.
        </p>
      </div>
    );
  }

  const totalHours = shifts.reduce((sum, s) => sum + s.hours_needed, 0);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-600 font-medium">
              Balancing Shifts Needed
            </p>
            <p className="text-2xl font-bold text-orange-600">
              {shifts.length}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-600 font-medium">Total Hours</p>
            <p className="text-2xl font-bold text-orange-600">
              {totalHours.toFixed(1)}h
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-600 font-medium">High Priority</p>
            <p className="text-2xl font-bold text-red-600">
              {shifts.filter((s) => s.priority === "high").length}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-600 font-medium">Period End</p>
            <p className="text-lg font-bold text-gray-900">{periodEndDate}</p>
          </div>
        </div>
      </div>

      {/* Shifts List */}
      <div className="space-y-2">
        {shifts.map((shift) => (
          <div
            key={shift.nurse_id}
            className={`border rounded-lg p-4 ${priorityColors[shift.priority]}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3 flex-1">
                <span className="text-2xl mt-1">
                  {priorityIcons[shift.priority]}
                </span>
                <div>
                  <p className="font-semibold text-lg">{shift.nurse_name}</p>
                  <p className="text-sm opacity-75">
                    Delta: {shift.delta > 0 ? "+" : ""}
                    {shift.delta.toFixed(1)} hours
                  </p>
                  <p className="text-sm opacity-75">
                    Recommended: {shift.recommended_date}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">
                  {shift.hours_needed.toFixed(1)}h
                </div>
                <div className="text-xs opacity-75 capitalize">
                  {shift.priority} Priority
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Action Button */}
      <button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-lg font-medium transition-colors">
        Schedule All Balancing Shifts
      </button>
    </div>
  );
}
