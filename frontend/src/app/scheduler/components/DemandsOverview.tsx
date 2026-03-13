"use client";

import React, { useState, useEffect } from "react";
import { listScheduleDemandsAPI, getComplianceScoreAPI } from "@/app/lib/api";

interface Demand {
  id: string;
  date: string;
  min_staff_required: number;
  actual_staff_assigned: number;
  is_active: boolean;
}

interface ComplianceScore {
  score: number;
  total_nurses: number;
  compliant_nurses: number;
  avg_delta: number;
  nurses_needing_bshift: number;
}

export function DemandsOverview({
  orgId,
  dateRange,
}: {
  orgId: string;
  dateRange: { start: string; end: string };
}) {
  const [demands, setDemands] = useState<Demand[]>([]);
  const [compliance, setCompliance] = useState<ComplianceScore | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const demandsData = await listScheduleDemandsAPI(
          orgId,
          dateRange.start,
          dateRange.end,
        );
        setDemands(demandsData.demands || []);

        const complianceData = await getComplianceScoreAPI(orgId);
        setCompliance(complianceData);
      } catch (error) {
        console.error("Failed to load demands:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [orgId, dateRange]);

  if (loading) {
    return <div className="text-gray-500 p-4">Loading demands...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Compliance Score Card */}
      {compliance && (
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-lg p-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="flex flex-col">
              <span className="text-sm text-gray-600 font-medium">
                Compliance Score
              </span>
              <span
                className={`text-3xl font-bold ${
                  compliance.score >= 80
                    ? "text-emerald-600"
                    : compliance.score >= 60
                      ? "text-yellow-600"
                      : "text-red-600"
                }`}
              >
                {compliance.score}%
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-gray-600 font-medium">
                Compliant Nurses
              </span>
              <span className="text-2xl font-bold text-emerald-700">
                {compliance.compliant_nurses}/{compliance.total_nurses}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-gray-600 font-medium">
                Avg Delta
              </span>
              <span
                className={`text-2xl font-bold ${
                  compliance.avg_delta >= 0
                    ? "text-emerald-600"
                    : "text-red-600"
                }`}
              >
                {compliance.avg_delta > 0 ? "+" : ""}
                {compliance.avg_delta.toFixed(1)}h
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-gray-600 font-medium">
                B-Shifts Needed
              </span>
              <span className="text-2xl font-bold text-orange-600">
                {compliance.nurses_needing_bshift}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-gray-600 font-medium">
                Tolerance
              </span>
              <span className="text-2xl font-bold text-gray-700">±5h</span>
            </div>
          </div>
        </div>
      )}

      {/* Demands Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Staffing Demands</h3>
          <p className="text-sm text-gray-600 mt-1">
            {demands.length} staffing cells for the selected period
          </p>
        </div>

        {demands.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Shift
                  </th>
                  <th className="px-6 py-3 text-center font-medium text-gray-700">
                    Min Required
                  </th>
                  <th className="px-6 py-3 text-center font-medium text-gray-700">
                    Assigned
                  </th>
                  <th className="px-6 py-3 text-center font-medium text-gray-700">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {demands.map((demand) => {
                  const isMet =
                    demand.actual_staff_assigned >= demand.min_staff_required;
                  const isOver =
                    demand.actual_staff_assigned > demand.min_staff_required;

                  return (
                    <tr key={demand.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-gray-900 font-medium">
                        {demand.date}
                      </td>
                      <td className="px-6 py-3 text-gray-600">
                        {demand.id.substring(0, 4)}
                      </td>
                      <td className="px-6 py-3 text-center text-gray-700">
                        {demand.min_staff_required}
                      </td>
                      <td className="px-6 py-3 text-center font-medium">
                        <span
                          className={
                            isOver
                              ? "text-blue-600"
                              : isMet
                                ? "text-emerald-600"
                                : "text-red-600"
                          }
                        >
                          {demand.actual_staff_assigned}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                            isOver
                              ? "bg-blue-100 text-blue-800"
                              : isMet
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-red-100 text-red-800"
                          }`}
                        >
                          {isOver ? "Over" : isMet ? "Met" : "Unmet"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-center text-gray-500">
            No staffing demands configured for this period
          </div>
        )}
      </div>
    </div>
  );
}
