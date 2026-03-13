"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

type CookiePreference = "accepted" | "rejected" | null;

export function CookieConsentBanner() {
  const [preference, setPreference] = useState<CookiePreference>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Check if user has already made a choice
    const saved = localStorage.getItem("cookie_consent");
    if (saved) {
      setPreference(saved as CookiePreference);
      setIsVisible(false);
    } else {
      setIsVisible(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem("cookie_consent", "accepted");
    setPreference("accepted");
    setIsVisible(false);
    // Load analytics, tracking, etc.
    loadAnalytics();
  };

  const handleReject = () => {
    localStorage.setItem("cookie_consent", "rejected");
    setPreference("rejected");
    setIsVisible(false);
  };

  const handleDismiss = () => {
    setIsVisible(false);
  };

  const loadAnalytics = () => {
    // TODO: Initialize analytics, Google Analytics, Hotjar, etc.
    console.log("Analytics enabled");
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900 mb-2">
              We use cookies to enhance your experience
            </p>
            <p className="text-xs text-gray-600">
              This website uses cookies to ensure you get the best experience on
              our platform. We use essential cookies for functionality and
              analytics to help us improve. See our{" "}
              <a
                href="/privacy-policy"
                className="text-emerald-600 hover:text-emerald-700 underline"
              >
                privacy policy
              </a>{" "}
              for more details.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleReject}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              Reject
            </button>
            <button
              onClick={handleAccept}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors"
            >
              Accept
            </button>
            <button
              onClick={handleDismiss}
              className="p-1 text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
