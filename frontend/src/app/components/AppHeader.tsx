"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import {
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/nextjs";
import { useOrganization } from "../context/OrganizationContext";
import { OrganizationSwitcherWrapper } from "./OrganizationSwitcherWrapper";
import { clearSensitiveData } from "../lib/sessionCleanup";
import { FEATURES } from "../lib/featureFlags";

const DEFAULT_LOGO = "/logo-placeholder.png";

export function AppHeader() {
  const { currentOrganization, isLoading, isAdmin } = useOrganization();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);

  // Prevent hydration mismatch with Clerk components
  useEffect(() => {
    setMounted(true);
  }, []);

  // Clear navigatingTo once the route actually changes
  useEffect(() => {
    setNavigatingTo(null);
  }, [pathname]);

  // Hide header on landing page
  if (pathname === "/") {
    return null;
  }

  const logoUrl = currentOrganization?.logo_url || DEFAULT_LOGO;

  const navItems = [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Schedules", href: isAdmin ? "/admin/schedules" : "/schedules" },
    { label: "Hand-offs", href: "/handover" },
    ...(isAdmin ? [{ label: "Staff", href: "/nurses" }] : []),
    ...(FEATURES.PATIENT_MANAGEMENT
      ? [{ label: "Patients", href: "/patients" }]
      : []),
  ];

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  return (
    <header className="sticky top-0 z-[45] flex justify-between items-center px-6 h-16 bg-white border-b border-gray-100">
      {/* Left: Logo */}
      <Link
        href="/dashboard"
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
      >
        {isLoading ? (
          <div className="h-12 w-12 bg-gray-100 rounded-full animate-pulse" />
        ) : (
          <img
            src={logoUrl}
            alt="Logo"
            className="h-12 w-auto object-contain"
            onError={(e) => {
              e.currentTarget.src = DEFAULT_LOGO;
            }}
          />
        )}
        <span className="text-lg font-semibold text-gray-900">Chronofy</span>
      </Link>

      {/* Center: Pill Navigation */}
      {mounted && (
        <SignedIn>
          <nav className="absolute left-1/2 -translate-x-1/2 flex items-center p-1 bg-gray-100 rounded-full">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  if (!isActive(item.href)) setNavigatingTo(item.href);
                }}
                className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-200 ${
                  isActive(item.href) || navigatingTo === item.href
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {navigatingTo === item.href ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 border-2 border-gray-400 border-t-gray-900 rounded-full animate-spin" />
                    {item.label}
                  </span>
                ) : (
                  item.label
                )}
              </Link>
            ))}
          </nav>
        </SignedIn>
      )}

      {/* Right: Actions */}
      <div className="flex gap-2 items-center">
        {mounted ? (
          <>
            <SignedOut>
              <SignInButton mode="modal">
                <button className="text-sm px-4 py-1.5 text-gray-600 hover:text-gray-900 font-medium transition-colors">
                  Sign in
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="text-sm px-4 py-1.5 bg-gray-900 hover:bg-gray-800 text-white rounded-full font-medium transition-colors">
                  Get Started
                </button>
              </SignUpButton>
            </SignedOut>
            <SignedIn>
              <OrganizationSwitcherWrapper />
              <Link
                href="/settings"
                className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                title="Settings"
              >
                <Settings className="w-4.5 h-4.5" />
              </Link>
              <UserButton
                signInUrl="/"
                afterSignOutUrl="/"
                appearance={{
                  elements: { userButtonAvatarBox: "w-8 h-8" },
                }}
              >
                <UserButton.MenuItems>
                  <UserButton.Action
                    label="Sign out"
                    labelIcon={<span>🚪</span>}
                    onClick={() => clearSensitiveData()}
                  />
                </UserButton.MenuItems>
              </UserButton>
            </SignedIn>
          </>
        ) : (
          <div className="w-8 h-8" /> // Placeholder to prevent layout shift
        )}
      </div>
    </header>
  );
}
