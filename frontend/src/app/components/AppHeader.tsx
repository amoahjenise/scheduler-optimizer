"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, Menu, X } from "lucide-react";
import {
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/nextjs";
import { useOrganization } from "../context/OrganizationContext";
import { OrganizationSwitcherWrapper } from "./OrganizationSwitcherWrapper";
import { FEATURES } from "../lib/featureFlags";
import LanguageSwitcher from "./LanguageSwitcher";
import { useTranslations } from "next-intl";

const DEFAULT_LOGO = "/logo-placeholder.png";

export function AppHeader() {
  const { currentOrganization, isLoading, isAdmin } = useOrganization();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const t = useTranslations("nav");

  // Prevent hydration mismatch with Clerk components
  useEffect(() => {
    setMounted(true);
  }, []);

  // Clear navigatingTo and close mobile menu when route changes
  useEffect(() => {
    setNavigatingTo(null);
    setMobileMenuOpen(false);
  }, [pathname]);

  // Hide header on landing page
  if (pathname === "/") {
    return null;
  }

  const logoUrl = currentOrganization?.logo_url || DEFAULT_LOGO;

  const navItems = [
    { label: t("dashboard"), href: "/dashboard" },
    {
      label: t("schedules"),
      href: isAdmin ? "/admin/schedules" : "/schedules",
    },
    { label: t("handover"), href: "/handover" },
    ...(isAdmin ? [{ label: t("nurses"), href: "/nurses" }] : []),
    ...(FEATURES.PATIENT_MANAGEMENT
      ? [{ label: t("patients"), href: "/patients" }]
      : []),
  ];

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  return (
    <>
      <header className="sticky top-0 z-[45] flex items-center h-16 px-4 md:px-6 bg-white border-b border-gray-100">
        {/* Left: Logo */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2 hover:opacity-80 transition-opacity flex-shrink-0"
        >
          {isLoading ? (
            <div className="h-10 w-10 bg-gray-100 rounded-full animate-pulse" />
          ) : (
            <img
              src={logoUrl}
              alt="Logo"
              className="h-10 w-auto object-contain"
              onError={(e) => {
                e.currentTarget.src = DEFAULT_LOGO;
              }}
            />
          )}
          <span className="hidden lg:block text-lg font-semibold text-gray-900">
            Chronofy
          </span>
        </Link>

        {/* Center: Pill Navigation — hidden on mobile */}
        {mounted && (
          <SignedIn>
            <nav className="hidden md:flex flex-1 justify-center min-w-0 px-3">
              <div className="flex items-center p-1 bg-gray-100 rounded-full min-w-0">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => {
                      if (!isActive(item.href)) setNavigatingTo(item.href);
                    }}
                    className={`px-3 lg:px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-200 whitespace-nowrap ${
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
              </div>
            </nav>
          </SignedIn>
        )}

        {/* Right: Actions */}
        <div className="flex gap-1 items-center ml-auto flex-shrink-0">
          {mounted ? (
            <>
              <SignedOut>
                <SignInButton mode="modal">
                  <button className="text-sm px-4 py-1.5 text-gray-600 hover:text-gray-900 font-medium transition-colors">
                    {t("signIn")}
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="text-sm px-4 py-1.5 bg-gray-900 hover:bg-gray-800 text-white rounded-full font-medium transition-colors">
                    {t("getStarted")}
                  </button>
                </SignUpButton>
              </SignedOut>
              <SignedIn>
                <OrganizationSwitcherWrapper />
                <div className="w-px h-5 bg-gray-200 mx-1" />
                <LanguageSwitcher />
                <Link
                  href="/settings"
                  className="p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-md hover:bg-gray-100"
                  title={t("settings")}
                >
                  <Settings className="w-4 h-4" />
                </Link>
                <UserButton
                  signInUrl="/"
                  afterSignOutUrl="/"
                  appearance={{
                    elements: { userButtonAvatarBox: "w-8 h-8" },
                  }}
                />
                {/* Mobile menu toggle */}
                <button
                  className="md:hidden p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                  onClick={() => setMobileMenuOpen((prev) => !prev)}
                  aria-label="Toggle navigation menu"
                >
                  {mobileMenuOpen ? (
                    <X className="w-5 h-5" />
                  ) : (
                    <Menu className="w-5 h-5" />
                  )}
                </button>
              </SignedIn>
            </>
          ) : (
            <div className="w-8 h-8" />
          )}
        </div>
      </header>

      {/* Mobile nav dropdown */}
      {mounted && mobileMenuOpen && (
        <SignedIn>
          <div className="md:hidden sticky top-16 z-[44] bg-white border-b border-gray-100 shadow-sm px-4 py-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  setMobileMenuOpen(false);
                  if (!isActive(item.href)) setNavigatingTo(item.href);
                }}
                className={`flex items-center px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                  isActive(item.href)
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </SignedIn>
      )}
    </>
  );
}
