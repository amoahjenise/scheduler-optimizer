"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Settings,
  Menu,
  X,
  LayoutDashboard,
  Calendar,
  ClipboardList,
  Users,
  UserCircle,
  Mic,
  Heart,
  GraduationCap,
  Megaphone,
  ChevronDown,
} from "lucide-react";
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

// Icon mapping for navigation items
const NAV_ICONS: Record<string, React.ReactNode> = {
  dashboard: <LayoutDashboard className="w-4 h-4" />,
  schedules: <Calendar className="w-4 h-4" />,
  handover: <ClipboardList className="w-4 h-4" />,
  nurses: <Users className="w-4 h-4" />,
  patients: <UserCircle className="w-4 h-4" />,
  ambient: <Mic className="w-4 h-4" />,
  burnout: <Heart className="w-4 h-4" />,
  learning: <GraduationCap className="w-4 h-4" />,
  announcements: <Megaphone className="w-4 h-4" />,
};

export function AppHeader() {
  const { currentOrganization, isLoading, canManage } = useOrganization();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [navDropdownOpen, setNavDropdownOpen] = useState(false);
  const navDropdownRef = useRef<HTMLDivElement>(null);
  const t = useTranslations("nav");

  // Prevent hydration mismatch with Clerk components
  useEffect(() => {
    setMounted(true);
  }, []);

  // Clear navigatingTo and close menus when route changes
  useEffect(() => {
    setNavigatingTo(null);
    setMobileMenuOpen(false);
    setNavDropdownOpen(false);
  }, [pathname]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        navDropdownRef.current &&
        !navDropdownRef.current.contains(event.target as Node)
      ) {
        setNavDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Hide header on landing page
  if (pathname === "/") {
    return null;
  }

  const logoUrl = currentOrganization?.logo_url || DEFAULT_LOGO;

  const navItems = [
    { label: t("dashboard"), href: "/dashboard", icon: "dashboard" },
    {
      label: t("schedules"),
      href: canManage ? "/admin/schedules" : "/schedules",
      icon: "schedules",
    },
    { label: t("handover"), href: "/handover", icon: "handover" },
    ...(canManage
      ? [{ label: t("nurses"), href: "/nurses", icon: "nurses" }]
      : []),
    ...(FEATURES.PATIENT_MANAGEMENT
      ? [{ label: t("patients"), href: "/patients", icon: "patients" }]
      : []),
    ...(FEATURES.AMBIENT_DOCUMENTATION
      ? [{ label: t("ambient"), href: "/ambient", icon: "ambient" }]
      : []),
    ...(FEATURES.BURNOUT_PREDICTOR && canManage
      ? [{ label: t("burnout"), href: "/burnout", icon: "burnout" }]
      : []),
    ...(FEATURES.MICRO_LEARNING
      ? [{ label: t("learning"), href: "/learning", icon: "learning" }]
      : []),
    {
      label: "Announcements",
      href: "/announcements",
      icon: "announcements",
    },
  ];

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  // Get current page label for the dropdown trigger
  const currentPage = navItems.find((item) => isActive(item.href));

  return (
    <>
      <header className="sticky top-0 z-[45] flex items-center h-14 px-4 bg-white border-b border-gray-100">
        {/* Left: Logo */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2 hover:opacity-80 transition-opacity flex-shrink-0"
        >
          {isLoading ? (
            <div className="h-8 w-8 bg-gray-100 rounded-full animate-pulse" />
          ) : (
            <img
              src={logoUrl}
              alt="Logo"
              className="h-8 w-auto object-contain"
              onError={(e) => {
                e.currentTarget.src = DEFAULT_LOGO;
              }}
            />
          )}
          <span className="hidden sm:block text-base font-semibold text-gray-900">
            Chronofy
          </span>
        </Link>

        {/* Center: Navigation Dropdown (Desktop) */}
        {mounted && (
          <SignedIn>
            <div
              className="hidden md:flex flex-1 justify-center"
              ref={navDropdownRef}
            >
              <div className="relative">
                <button
                  onClick={() => setNavDropdownOpen(!navDropdownOpen)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                    navDropdownOpen
                      ? "bg-gray-100 text-gray-900"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                  }`}
                >
                  {currentPage && NAV_ICONS[currentPage.icon]}
                  <span>{currentPage?.label || t("dashboard")}</span>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${navDropdownOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {/* Dropdown Menu */}
                {navDropdownOpen && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50">
                    {navItems.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => {
                          setNavDropdownOpen(false);
                          if (!isActive(item.href)) setNavigatingTo(item.href);
                        }}
                        className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                          isActive(item.href) || navigatingTo === item.href
                            ? "bg-blue-50 text-blue-700 font-medium"
                            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                        }`}
                      >
                        <span
                          className={
                            isActive(item.href)
                              ? "text-blue-600"
                              : "text-gray-400"
                          }
                        >
                          {NAV_ICONS[item.icon]}
                        </span>
                        {navigatingTo === item.href ? (
                          <span className="flex items-center gap-2">
                            <span className="w-3 h-3 border-2 border-gray-400 border-t-blue-600 rounded-full animate-spin" />
                            {item.label}
                          </span>
                        ) : (
                          item.label
                        )}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </SignedIn>
        )}

        {/* Right: Actions */}
        <div className="flex gap-1.5 items-center ml-auto flex-shrink-0">
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
                <div className="w-px h-5 bg-gray-200 mx-0.5" />
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
                  fallbackRedirectUrl="/"
                  appearance={{
                    elements: { userButtonAvatarBox: "w-7 h-7" },
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
          <div className="md:hidden fixed inset-0 top-14 z-[44] bg-black/20 backdrop-blur-sm">
            <div className="bg-white border-b border-gray-100 shadow-lg px-4 py-3">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => {
                    setMobileMenuOpen(false);
                    if (!isActive(item.href)) setNavigatingTo(item.href);
                  }}
                  className={`flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                    isActive(item.href)
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                >
                  <span
                    className={
                      isActive(item.href) ? "text-blue-600" : "text-gray-400"
                    }
                  >
                    {NAV_ICONS[item.icon]}
                  </span>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </SignedIn>
      )}
    </>
  );
}
