"use client";

import React from "react";
import { Calendar, Users, Settings, Home, ChevronRight } from "lucide-react";

interface NavItem {
  icon: React.ReactNode;
  label: string;
  href?: string;
  active?: boolean;
  badge?: number;
}

interface SchedulerLayoutProps {
  children?: React.ReactNode;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  showSidebar?: boolean;
}

export function SchedulerLayout({
  children,
  activeTab = "schedule",
  onTabChange,
  showSidebar = true,
}: SchedulerLayoutProps) {
  const navItems: NavItem[] = [
    {
      icon: <Calendar className="w-5 h-5" />,
      label: "Schedule",
      href: "#schedule",
      active: activeTab === "schedule",
    },
    {
      icon: <Users className="w-5 h-5" />,
      label: "Staff",
      href: "#staff",
      active: activeTab === "staff",
    },
    {
      icon: <Settings className="w-5 h-5" />,
      label: "Settings",
      href: "#settings",
      active: activeTab === "settings",
    },
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Left Sidebar - Navigation */}
      {showSidebar && (
        <aside className="w-64 bg-white border-r border-gray-200 shadow-sm flex flex-col">
          {/* Logo/Brand */}
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-600 to-teal-600 rounded-lg flex items-center justify-center">
                <Calendar className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-lg text-gray-900">SchedOptim</h1>
                <p className="text-xs text-gray-500">Healthcare Scheduling</p>
              </div>
            </div>
          </div>

          {/* Navigation Menu */}
          <nav className="flex-1 px-4 py-6 space-y-2">
            {navItems.map((item, idx) => (
              <button
                key={idx}
                onClick={() => onTabChange?.(item.href?.replace("#", "") || "")}
                className={`w-full px-4 py-3 rounded-lg flex items-center justify-between transition-all ${
                  item.active
                    ? "bg-emerald-50 text-emerald-700 border-l-4 border-emerald-600"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  {item.icon}
                  <span className="font-medium text-sm">{item.label}</span>
                </div>
                {item.badge && (
                  <span className="bg-red-500 text-white text-xs rounded-full px-2 py-1">
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {/* Compliance Footer */}
          <div className="p-4 border-t border-gray-100 space-y-3">
            <div className="text-xs text-gray-600 space-y-1">
              <p className="font-semibold text-gray-700">🔒 Certified</p>
              <p>✓ ISO 27001</p>
              <p>✓ GDPR & HIPAA</p>
            </div>
          </div>
        </aside>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-600">
              <Home className="w-5 h-5" />
              <ChevronRight className="w-5 h-5" />
              <span className="text-sm font-medium capitalize">
                {activeTab}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <svg
                  className="w-5 h-5 text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
              </button>
              <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                <span className="text-sm font-semibold text-emerald-700">
                  A
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto px-6 py-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

// Export a wrapper that provides modern styling to scheduler
export function EnhancedSchedulerWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      {children}
    </div>
  );
}
