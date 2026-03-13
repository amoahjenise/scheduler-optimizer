"use client";

import React from "react";
import { useOrganization } from "../context/OrganizationContext";
import { OnboardingModal } from "./OnboardingModal";

/**
 * Wrapper component that renders the OnboardingModal at the root level
 * to ensure proper z-index layering (not constrained by header positioning)
 */
export function OnboardingModalWrapper() {
  const { needsOnboarding, isLoading } = useOrganization();

  // Don't show while loading
  if (isLoading) return null;

  return (
    <OnboardingModal
      isOpen={needsOnboarding}
      onClose={() => {
        // Can't close onboarding until they create/join an org
      }}
    />
  );
}
