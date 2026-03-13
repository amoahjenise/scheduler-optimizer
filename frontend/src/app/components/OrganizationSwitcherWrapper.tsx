"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useOrganization } from "../context/OrganizationContext";
import { OrganizationSwitcher } from "./OrganizationSwitcher";

// Portal component to render modals at document root
function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted) return null;

  return createPortal(children, document.body);
}

export function OrganizationSwitcherWrapper() {
  const { needsOnboarding, isLoading } = useOrganization();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showShareCodeModal, setShowShareCodeModal] = useState(false);

  // Don't show switcher if user needs onboarding (modal handled at root level)
  if (needsOnboarding || isLoading) {
    return null;
  }

  return (
    <>
      <OrganizationSwitcher
        onCreateOrg={() => setShowCreateModal(true)}
        onJoinOrg={() => setShowJoinModal(true)}
        onShareCode={() => setShowShareCodeModal(true)}
      />

      {/* Create Organization Modal */}
      {showCreateModal && (
        <Portal>
          <CreateOrgModal onClose={() => setShowCreateModal(false)} />
        </Portal>
      )}

      {/* Join Organization Modal */}
      {showJoinModal && (
        <Portal>
          <JoinOrgModal onClose={() => setShowJoinModal(false)} />
        </Portal>
      )}

      {/* Share Invite Code Modal */}
      {showShareCodeModal && (
        <Portal>
          <ShareCodeModal onClose={() => setShowShareCodeModal(false)} />
        </Portal>
      )}
    </>
  );
}

function CreateOrgModal({ onClose }: { onClose: () => void }) {
  const { createOrganization } = useOrganization();
  const [orgName, setOrgName] = useState("");
  const [orgDescription, setOrgDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to create organization",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          Create Organization
        </h2>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Organization Name *
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="e.g., Montreal Children's Hospital"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description (optional)
            </label>
            <textarea
              value={orgDescription}
              onChange={(e) => setOrgDescription(e.target.value)}
              placeholder="Brief description..."
              rows={2}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
            >
              {isSubmitting ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function JoinOrgModal({ onClose }: { onClose: () => void }) {
  const { joinOrganization } = useOrganization();
  const [inviteCode, setInviteCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) {
      setError("Invite code is required");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await joinOrganization(inviteCode.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join organization");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-auto my-auto p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          Join Organization
        </h2>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Invite Code *
            </label>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="Enter invite code"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none uppercase tracking-wider text-center font-mono text-lg"
              autoFocus
            />
            <p className="text-sm text-gray-500 mt-2">
              Ask your organization admin for the invite code
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-medium disabled:opacity-50"
            >
              {isSubmitting ? "Joining..." : "Join"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ShareCodeModal({ onClose }: { onClose: () => void }) {
  const { currentOrganization } = useOrganization();
  const [copied, setCopied] = useState(false);

  const inviteCode = currentOrganization?.invite_code || "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-auto my-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          Share Invite Code
        </h2>
        <p className="text-gray-600 text-sm mb-6">
          Share this code with team members to invite them to{" "}
          <span className="font-medium">{currentOrganization?.name}</span>
        </p>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
          <div className="text-center">
            <p className="text-sm text-gray-500 mb-2">Invite Code</p>
            <p className="text-3xl font-mono font-bold tracking-wider text-gray-900">
              {inviteCode}
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors font-medium"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                Copy Code
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
