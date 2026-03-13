"use client";

import React, { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { useOrganization } from "../context/OrganizationContext";
import { Building2, Users, X, ArrowRight, Loader2, LogOut } from "lucide-react";

interface OnboardingModalProps {
  isOpen: boolean;
  onClose?: () => void;
}

export function OnboardingModal({ isOpen, onClose }: OnboardingModalProps) {
  const { signOut } = useClerk();
  const { createOrganization, joinOrganization } = useOrganization();
  const [step, setStep] = useState<"choose" | "create" | "join">("choose");
  const [orgName, setOrgName] = useState("");
  const [orgDescription, setOrgDescription] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleSignOut = async () => {
    await signOut();
  };

  const handleCreate = async () => {
    if (!orgName.trim()) {
      setError("Organization name is required");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await createOrganization(
        orgName.trim(),
        orgDescription.trim() || undefined,
      );
      onClose?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to create organization",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoin = async () => {
    if (!inviteCode.trim()) {
      setError("Invite code is required");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await joinOrganization(inviteCode.trim());
      onClose?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join organization");
    } finally {
      setIsSubmitting(false);
    }
  };

  const goBack = () => {
    setStep("choose");
    setError("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-auto my-auto overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 px-6 py-6 text-white text-center relative overflow-hidden">
          {/* Decorative medical cross pattern */}
          <div className="absolute inset-0 opacity-5">
            <div className="absolute top-2 left-4 w-8 h-8 border-2 border-white rounded-sm rotate-45" />
            <div className="absolute bottom-4 right-6 w-6 h-6 border-2 border-white rounded-sm" />
          </div>
          <div className="relative">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-xl font-bold mb-1">
              Set Up Your Hospital Unit
            </h2>
            <p className="text-blue-100 text-sm">
              {step === "choose"
                ? "Create a new unit or join your team"
                : step === "create"
                  ? "Enter your hospital unit details"
                  : "Join your team with an invite code"}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          {step === "choose" && (
            <div className="space-y-4">
              <button
                onClick={() => setStep("create")}
                className="w-full flex items-center gap-4 p-4 border-2 border-gray-200 rounded-xl hover:bg-blue-50/50 hover:border-blue-400 transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-colors group-hover:scale-105">
                  <Building2 className="w-6 h-6 text-blue-600" />
                </div>
                <div className="flex-1 text-left">
                  <h3 className="font-semibold text-gray-900">
                    Create Hospital Unit
                  </h3>
                  <p className="text-sm text-gray-500">
                    I'm the admin setting up a new unit
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
              </button>

              <button
                onClick={() => setStep("join")}
                className="w-full flex items-center gap-4 p-4 border-2 border-gray-200 rounded-xl hover:bg-emerald-50/50 hover:border-emerald-400 transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center group-hover:bg-emerald-200 transition-colors group-hover:scale-105">
                  <Users className="w-6 h-6 text-emerald-600" />
                </div>
                <div className="flex-1 text-left">
                  <h3 className="font-semibold text-gray-900">Join My Team</h3>
                  <p className="text-sm text-gray-500">
                    I have an invite code from my unit
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-emerald-600 group-hover:translate-x-1 transition-all" />
              </button>
            </div>
          )}

          {step === "create" && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Hospital Unit Name *
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="e.g., MCH Hema-Oncology Unit"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Unit Description (optional)
                </label>
                <textarea
                  value={orgDescription}
                  onChange={(e) => setOrgDescription(e.target.value)}
                  placeholder="e.g., Pediatric oncology, 12 beds, 24/7 care"
                  rows={2}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={goBack}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors font-medium"
                >
                  Back
                </button>
                <button
                  onClick={handleCreate}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Organization"
                  )}
                </button>
              </div>
            </div>
          )}

          {step === "join" && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Invite Code *
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="Enter your invite code"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all uppercase tracking-wider text-center font-mono text-lg"
                  autoFocus
                />
                <p className="text-sm text-gray-500 mt-2">
                  Ask your organization admin for the invite code
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={goBack}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors font-medium"
                >
                  Back
                </button>
                <button
                  onClick={handleJoin}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Joining...
                    </>
                  ) : (
                    "Join Organization"
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer note */}
        {step === "choose" && (
          <div className="px-6 py-4 bg-gray-50 text-center space-y-3">
            <p className="text-sm text-gray-500">
              You can create multiple organizations or join existing ones later
            </p>
            <button
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out and use a different account
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
