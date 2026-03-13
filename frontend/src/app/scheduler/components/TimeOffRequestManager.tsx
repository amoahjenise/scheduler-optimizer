"use client";

import React, { useState, useEffect } from "react";
import {
  listTimeOffRequestsAPI,
  approveTimeOffRequestAPI,
  denyTimeOffRequestAPI,
} from "@/app/lib/api";

interface TimeOffRequest {
  id: string;
  nurse_id: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
  notes?: string;
  created_at: string;
}

export function TimeOffRequestManager({
  orgId,
  currentUserId,
}: {
  orgId: string;
  currentUserId: string;
}) {
  const [requests, setRequests] = useState<TimeOffRequest[]>([]);
  const [filter, setFilter] = useState<"pending" | "approved" | "denied">(
    "pending",
  );
  const [loading, setLoading] = useState(true);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");

  useEffect(() => {
    async function loadRequests() {
      setLoading(true);
      try {
        const data = await listTimeOffRequestsAPI(orgId, filter);
        setRequests(data || []);
      } catch (error) {
        console.error("Failed to load time-off requests:", error);
      } finally {
        setLoading(false);
      }
    }

    loadRequests();
  }, [orgId, filter]);

  const handleApprove = async (requestId: string) => {
    try {
      await approveTimeOffRequestAPI(requestId, {
        approved_by_id: currentUserId,
      });
      setRequests(requests.filter((r) => r.id !== requestId));
    } catch (error) {
      console.error("Failed to approve request:", error);
    }
  };

  const handleDeny = async (requestId: string) => {
    try {
      await denyTimeOffRequestAPI(requestId, {
        approved_by_id: currentUserId,
        denial_reason: denyReason,
      });
      setRequests(requests.filter((r) => r.id !== requestId));
      setDenyingId(null);
      setDenyReason("");
    } catch (error) {
      console.error("Failed to deny request:", error);
    }
  };

  const reasonColors: Record<string, string> = {
    vacation: "bg-blue-100 text-blue-800",
    sick: "bg-red-100 text-red-800",
    personal: "bg-yellow-100 text-yellow-800",
    family: "bg-purple-100 text-purple-800",
  };

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {(["pending", "approved", "denied"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-4 py-2 font-medium text-sm capitalize border-b-2 transition-colors ${
              filter === tab
                ? "border-emerald-600 text-emerald-600"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            {tab}
            {filter === tab && (
              <span className="ml-2 inline-block bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full text-xs font-semibold">
                {requests.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Requests List */}
      {loading ? (
        <div className="text-gray-500 p-4 text-center">Loading...</div>
      ) : requests.length > 0 ? (
        <div className="space-y-3">
          {requests.map((req) => (
            <div
              key={req.id}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-medium capitalize ${reasonColors[req.reason] || "bg-gray-100 text-gray-800"}`}
                    >
                      {req.reason}
                    </span>
                    <span className="text-sm font-medium text-gray-900">
                      {req.start_date} to {req.end_date}
                    </span>
                  </div>
                  {req.notes && (
                    <p className="text-sm text-gray-600 mt-2">{req.notes}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    Requested: {new Date(req.created_at).toLocaleDateString()}
                  </p>
                </div>

                {filter === "pending" && (
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => handleApprove(req.id)}
                      className="px-3 py-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded text-sm font-medium transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => setDenyingId(req.id)}
                      className="px-3 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded text-sm font-medium transition-colors"
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>

              {/* Deny Reason Modal */}
              {denyingId === req.id && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
                  <textarea
                    value={denyReason}
                    onChange={(e) => setDenyReason(e.target.value)}
                    placeholder="Enter reason for denial..."
                    className="w-full px-3 py-2 border border-red-300 rounded text-sm"
                    rows={2}
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleDeny(req.id)}
                      className="px-3 py-1 bg-red-600 text-white hover:bg-red-700 rounded text-sm font-medium"
                    >
                      Confirm Denial
                    </button>
                    <button
                      onClick={() => {
                        setDenyingId(null);
                        setDenyReason("");
                      }}
                      className="px-3 py-1 bg-gray-200 text-gray-700 hover:bg-gray-300 rounded text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center p-6 text-gray-500">
          No {filter} time-off requests
        </div>
      )}
    </div>
  );
}
