"use client";

import React, { useState, useRef, useEffect } from "react";
import { useOrganization } from "../context/OrganizationContext";
import {
  Building2,
  ChevronDown,
  Check,
  Plus,
  Users,
  LogIn,
} from "lucide-react";

interface OrganizationSwitcherProps {
  onCreateOrg?: () => void;
  onJoinOrg?: () => void;
  onShareCode?: () => void;
}

export function OrganizationSwitcher({
  onCreateOrg,
  onJoinOrg,
  onShareCode,
}: OrganizationSwitcherProps) {
  const {
    currentOrganization,
    currentMembership,
    organizations,
    setCurrentOrganization,
    isLoading,
    isAdmin,
  } = useOrganization();

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg animate-pulse">
        <div className="w-6 h-6 bg-gray-200 rounded" />
        <div className="w-24 h-4 bg-gray-200 rounded" />
      </div>
    );
  }

  if (!currentOrganization) {
    return (
      <div className="relative z-[110]" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
        >
          <Building2 className="w-5 h-5 text-gray-600" />
          <span className="font-medium text-gray-900">Organizations</span>
          <ChevronDown
            className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-[120]">
            <div className="px-3 py-2 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase">
                Get Started
              </p>
            </div>
            <button
              onClick={() => {
                setIsOpen(false);
                onCreateOrg?.();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create organization</span>
            </button>
            <button
              onClick={() => {
                setIsOpen(false);
                onJoinOrg?.();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <LogIn className="w-4 h-4" />
              <span>Join organization</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  const roleColors = {
    admin: "bg-purple-100 text-purple-700",
    manager: "bg-blue-100 text-blue-700",
    nurse: "bg-green-100 text-green-700",
  };

  return (
    <div className="relative z-[110]" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
      >
        <Building2 className="w-5 h-5 text-gray-600" />
        <span className="font-medium text-gray-900 max-w-[150px] truncate">
          {currentOrganization.name}
        </span>
        {currentMembership && (
          <span
            className={`px-2 py-0.5 text-xs font-medium rounded-full ${roleColors[currentMembership.role]}`}
          >
            {currentMembership.role}
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-[120]">
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-500 uppercase">
              Your Organizations
            </p>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {organizations.map((membership) => (
              <button
                key={membership.organization_id}
                onClick={() => {
                  setCurrentOrganization(membership.organization_id);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors ${
                  currentOrganization?.id === membership.organization_id
                    ? "bg-blue-50"
                    : ""
                }`}
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-sm">
                  {membership.organization.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 text-left">
                  <p className="font-medium text-gray-900 truncate">
                    {membership.organization.name}
                  </p>
                  <p
                    className={`text-xs ${roleColors[membership.role]} inline-block px-1.5 py-0.5 rounded-full mt-0.5`}
                  >
                    {membership.role}
                  </p>
                </div>
                {currentOrganization?.id === membership.organization_id && (
                  <Check className="w-4 h-4 text-blue-600" />
                )}
              </button>
            ))}
          </div>

          <div className="border-t border-gray-100 pt-2 mt-2">
            <button
              onClick={() => {
                setIsOpen(false);
                onCreateOrg?.();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create new organization</span>
            </button>
            <button
              onClick={() => {
                setIsOpen(false);
                onJoinOrg?.();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Users className="w-4 h-4" />
              <span>Join another organization</span>
            </button>
            {isAdmin && (
              <button
                onClick={() => {
                  setIsOpen(false);
                  onShareCode?.();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                  />
                </svg>
                <span>Share invite code</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
