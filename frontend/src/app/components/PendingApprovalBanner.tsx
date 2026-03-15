"use client";

import { useOrganization } from "../context/OrganizationContext";
import { Clock, ShieldAlert } from "lucide-react";

/**
 * Full-page overlay shown when the user's membership is pending admin approval.
 * Blocks access to all org resources until approved.
 */
export default function PendingApprovalBanner() {
  const { isPendingApproval, currentOrganization, refreshOrganizations } =
    useOrganization();

  if (!isPendingApproval) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-gray-50/95 backdrop-blur-sm">
      <div className="max-w-md w-full mx-4 bg-white rounded-2xl shadow-xl border border-amber-200 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-5 text-white text-center">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
            <ShieldAlert className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-bold">Membership Pending Approval</h2>
        </div>

        {/* Body */}
        <div className="px-6 py-6 text-center space-y-4">
          <div className="flex items-center justify-center gap-2 text-amber-600">
            <Clock className="w-5 h-5 animate-pulse" />
            <span className="font-medium">Waiting for admin approval</span>
          </div>

          <p className="text-gray-600 text-sm leading-relaxed">
            Your request to join{" "}
            <span className="font-semibold text-gray-900">
              {currentOrganization?.name || "this organization"}
            </span>{" "}
            has been submitted. An administrator needs to approve your
            membership before you can access the system.
          </p>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-blue-700 text-xs">
              💡 Contact your unit administrator to request faster approval.
              They can approve you from the Settings page.
            </p>
          </div>

          <button
            onClick={() => refreshOrganizations()}
            className="mt-4 px-6 py-2.5 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors font-medium text-sm"
          >
            Check Status
          </button>
        </div>
      </div>
    </div>
  );
}
