"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { useAuth, useUser } from "@clerk/nextjs";

const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"
).replace(/\/$/, "");

// Types
export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string;
  timezone: string;
  full_time_weekly_target?: number; // bi-weekly hours (default 75)
  part_time_weekly_target?: number; // bi-weekly hours (default 63.75)
  is_active: boolean;
  invite_code?: string;
  logo_url?: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMembership {
  id: string;
  organization_id: string;
  user_id: string;
  user_email?: string;
  user_name?: string;
  role: "admin" | "manager" | "nurse";
  is_active: boolean;
  is_approved: boolean;
  joined_at: string;
  updated_at: string;
  organization: Organization;
}

export interface UserContext {
  user_id: string;
  user_email?: string;
  user_name?: string;
  organizations: OrganizationMembership[];
  current_organization_id?: string;
  current_role?: string;
}

interface OrganizationContextType {
  // Current organization state
  currentOrganization: Organization | null;
  currentMembership: OrganizationMembership | null;
  organizations: OrganizationMembership[];
  isLoading: boolean;
  error: string | null;
  needsOnboarding: boolean;

  // Role helpers
  isAdmin: boolean;
  isPendingApproval: boolean;

  // Actions
  setCurrentOrganization: (orgId: string) => void;
  createOrganization: (
    name: string,
    description?: string,
  ) => Promise<Organization>;
  joinOrganization: (inviteCode: string) => Promise<OrganizationMembership>;
  approveMember: (orgId: string, memberId: string) => Promise<void>;
  rejectMember: (orgId: string, memberId: string) => Promise<void>;
  leaveOrganization: (orgId: string) => Promise<void>;
  refreshOrganizations: () => Promise<void>;
  updateOrganizationLogo: (logoUrl: string) => Promise<void>;
  updateOrganizationWeeklyTargets: (
    fullTimeBiWeeklyTarget: number,
    partTimeBiWeeklyTarget: number,
  ) => Promise<void>;

  // Helper to get auth headers for API calls
  getAuthHeaders: () => Promise<Record<string, string>>;
}

const OrganizationContext = createContext<OrganizationContextType | null>(null);

export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error("useOrganization must be used within OrganizationProvider");
  }
  return context;
}

const ORG_STORAGE_KEY = "chronofy_current_org";
const ONBOARDING_COMPLETED_KEY = "chronofy_onboarding_completed";

export function OrganizationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();

  const [organizations, setOrganizations] = useState<OrganizationMembership[]>(
    [],
  );
  const [currentOrganization, setCurrentOrgState] =
    useState<Organization | null>(null);
  const [currentMembership, setCurrentMembership] =
    useState<OrganizationMembership | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean>(
    () => {
      if (typeof window !== "undefined") {
        return localStorage.getItem(ONBOARDING_COMPLETED_KEY) === "true";
      }
      return false;
    },
  );

  // Get auth headers for API calls
  const getAuthHeaders = useCallback(async (): Promise<
    Record<string, string>
  > => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (isSignedIn) {
      try {
        const token = await getToken();
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
      } catch (e) {
        console.error("Failed to get auth token:", e);
      }
    }

    if (currentOrganization) {
      headers["X-Organization-ID"] = currentOrganization.id;
    }

    return headers;
  }, [getToken, isSignedIn, currentOrganization]);

  // Fetch user's organizations
  const refreshOrganizations = useCallback(async () => {
    if (!isSignedIn) {
      setOrganizations([]);
      setCurrentOrgState(null);
      setCurrentMembership(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      console.log("[OrganizationContext] Refreshing organizations...");
      const token = await getToken();
      console.log(
        "[OrganizationContext] Token for refresh:",
        token ? `${token.substring(0, 20)}...` : "NULL",
      );

      // If no token, user might still be loading
      if (!token) {
        console.log("[OrganizationContext] No auth token available yet");
        setOrganizations([]);
        setCurrentOrgState(null);
        setCurrentMembership(null);
        return;
      }

      let res: Response;
      try {
        res = await fetch(`${API_BASE}/organizations/`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (networkError) {
        console.warn(
          "[OrganizationContext] Organizations fetch network failure",
          networkError,
        );
        setError("Unable to reach backend API");
        setOrganizations([]);
        setCurrentOrgState(null);
        setCurrentMembership(null);
        return;
      }

      console.log("[OrganizationContext] Refresh response status:", res.status);

      if (!res.ok) {
        // For 401/403 errors, treat as no organizations (new user)
        if (res.status === 401 || res.status === 403) {
          const errBody = await res.json().catch(() => ({}));
          console.log("[OrganizationContext] Auth error:", errBody);
          console.log(
            "[OrganizationContext] User not authorized yet - treating as new user",
          );
          setOrganizations([]);
          setCurrentOrgState(null);
          setCurrentMembership(null);
          return;
        }
        throw new Error("Failed to fetch organizations");
      }

      const orgs: OrganizationMembership[] = await res.json();
      setOrganizations(orgs);

      // If user has organizations, they've completed onboarding
      if (orgs.length > 0) {
        localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
        setOnboardingCompleted(true);
      }

      // Restore last selected org or use first one
      const savedOrgId = localStorage.getItem(ORG_STORAGE_KEY);
      const savedOrg = orgs.find((m) => m.organization_id === savedOrgId);

      if (savedOrg) {
        setCurrentOrgState(savedOrg.organization);
        setCurrentMembership(savedOrg);
      } else if (orgs.length > 0) {
        setCurrentOrgState(orgs[0].organization);
        setCurrentMembership(orgs[0]);
        localStorage.setItem(ORG_STORAGE_KEY, orgs[0].organization_id);
      }
    } catch (e) {
      console.warn("Failed to fetch organizations:", e);
      setError(
        e instanceof Error ? e.message : "Failed to fetch organizations",
      );
    } finally {
      setIsLoading(false);
    }
  }, [getToken, isSignedIn]);

  // Set current organization
  const setCurrentOrganization = useCallback(
    (orgId: string) => {
      const membership = organizations.find((m) => m.organization_id === orgId);
      if (membership) {
        setCurrentOrgState(membership.organization);
        setCurrentMembership(membership);
        localStorage.setItem(ORG_STORAGE_KEY, orgId);
      }
    },
    [organizations],
  );

  // Create a new organization
  const createOrganization = useCallback(
    async (name: string, description?: string): Promise<Organization> => {
      console.log("[OrganizationContext] Creating organization...");
      const token = await getToken();
      console.log(
        "[OrganizationContext] Token retrieved:",
        token ? "YES" : "NO",
      );

      if (!token) {
        console.error("[OrganizationContext] No token available");
        throw new Error("Not authenticated. Please sign in again.");
      }

      const res = await fetch(`${API_BASE}/organizations/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, description }),
      });

      console.log("[OrganizationContext] Create response status:", res.status);

      if (!res.ok) {
        const text = await res.text();
        console.error("[OrganizationContext] Create error raw:", text);
        let err: { detail?: string } = {};
        try {
          err = JSON.parse(text);
        } catch {
          err = { detail: text || `HTTP ${res.status}` };
        }
        console.error("[OrganizationContext] Create error parsed:", err);
        throw new Error(err.detail || "Failed to create organization");
      }

      const org: Organization = await res.json();
      localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
      setOnboardingCompleted(true);
      await refreshOrganizations();
      setCurrentOrganization(org.id);
      return org;
    },
    [getToken, refreshOrganizations, setCurrentOrganization],
  );

  // Join an organization with invite code
  const joinOrganization = useCallback(
    async (inviteCode: string): Promise<OrganizationMembership> => {
      const token = await getToken();

      if (!token) {
        throw new Error("Not authenticated. Please sign in again.");
      }

      const res = await fetch(`${API_BASE}/organizations/join`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ invite_code: inviteCode }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to join organization");
      }

      const membership: OrganizationMembership = await res.json();
      localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
      setOnboardingCompleted(true);
      await refreshOrganizations();
      return membership;
    },
    [getToken, refreshOrganizations],
  );

  // Update organization logo
  const updateOrganizationLogo = useCallback(
    async (logoUrl: string): Promise<void> => {
      if (!currentOrganization) {
        throw new Error("No organization selected");
      }

      const token = await getToken();
      if (!token) {
        throw new Error("Not authenticated. Please sign in again.");
      }

      const res = await fetch(
        `${API_BASE}/organizations/${currentOrganization.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Organization-ID": currentOrganization.id,
          },
          body: JSON.stringify({ logo_url: logoUrl }),
        },
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to update logo");
      }

      // Update local state immediately
      setCurrentOrgState((prev) =>
        prev ? { ...prev, logo_url: logoUrl } : null,
      );

      // Refresh to sync with server
      await refreshOrganizations();
    },
    [currentOrganization, getToken, refreshOrganizations],
  );

  // Update organization weekly hour defaults
  const updateOrganizationWeeklyTargets = useCallback(
    async (
      fullTimeBiWeeklyTarget: number,
      partTimeBiWeeklyTarget: number,
    ): Promise<void> => {
      if (!currentOrganization) {
        throw new Error("No organization selected");
      }

      const token = await getToken();
      if (!token) {
        throw new Error("Not authenticated. Please sign in again.");
      }

      const res = await fetch(
        `${API_BASE}/organizations/${currentOrganization.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Organization-ID": currentOrganization.id,
          },
          body: JSON.stringify({
            full_time_weekly_target: fullTimeBiWeeklyTarget,
            part_time_weekly_target: partTimeBiWeeklyTarget,
          }),
        },
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to update weekly targets");
      }

      // Update local state immediately
      setCurrentOrgState((prev) =>
        prev
          ? {
              ...prev,
              full_time_weekly_target: fullTimeBiWeeklyTarget,
              part_time_weekly_target: partTimeBiWeeklyTarget,
            }
          : null,
      );

      // Refresh to sync with server
      await refreshOrganizations();
    },
    [currentOrganization, getToken, refreshOrganizations],
  );

  // Approve a pending member (admin only)
  const approveMember = useCallback(
    async (orgId: string, memberId: string): Promise<void> => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch(
        `${API_BASE}/organizations/${orgId}/members/${memberId}/approve`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Organization-ID": orgId,
          },
        },
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to approve member");
      }

      await refreshOrganizations();
    },
    [getToken, refreshOrganizations],
  );

  // Reject a pending member (admin only)
  const rejectMember = useCallback(
    async (orgId: string, memberId: string): Promise<void> => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch(
        `${API_BASE}/organizations/${orgId}/members/${memberId}/reject`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Organization-ID": orgId,
          },
        },
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to reject member");
      }

      await refreshOrganizations();
    },
    [getToken, refreshOrganizations],
  );

  // Leave an organization
  const leaveOrganization = useCallback(
    async (orgId: string): Promise<void> => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch(`${API_BASE}/organizations/${orgId}/leave`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Organization-ID": orgId,
        },
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to leave organization");
      }

      // Clear current org if it was the one we left
      if (currentOrganization?.id === orgId) {
        localStorage.removeItem(ORG_STORAGE_KEY);
      }

      await refreshOrganizations();
    },
    [getToken, refreshOrganizations, currentOrganization],
  );
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      refreshOrganizations();
    } else if (isLoaded && !isSignedIn) {
      // Clear state when signed out
      setOrganizations([]);
      setCurrentOrgState(null);
      setCurrentMembership(null);
      setIsLoading(false);
      // Don't clear onboarding flag - it will be re-evaluated on next login
      // by checking if organizations exist
    }
  }, [isLoaded, isSignedIn, refreshOrganizations]);

  // Computed: is user admin in current org?
  const isAdmin: boolean =
    currentMembership?.role === "admin" ||
    currentMembership?.role === "manager" ||
    false;

  // Computed: is current membership pending approval?
  const isPendingApproval: boolean =
    currentMembership?.is_approved === false || false;

  const value: OrganizationContextType = {
    currentOrganization,
    currentMembership,
    organizations,
    isLoading,
    error,
    // Show onboarding modal only if: user is signed in, done loading,
    // AND has no organizations (organizations.length === 0)
    // Don't rely on onboardingCompleted flag as it can get out of sync
    needsOnboarding: !!isSignedIn && !isLoading && organizations.length === 0,
    isAdmin,
    isPendingApproval,
    setCurrentOrganization,
    createOrganization,
    joinOrganization,
    approveMember,
    rejectMember,
    leaveOrganization,
    refreshOrganizations,
    updateOrganizationLogo,
    updateOrganizationWeeklyTargets,
    getAuthHeaders,
  };

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}
