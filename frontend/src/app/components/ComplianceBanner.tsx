/**
 * ComplianceBanner — persistent footer banner reminding staff of HIPAA
 * obligations, encryption status, and data handling policies.
 */

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export default function ComplianceBanner() {
  const [dismissed, setDismissed] = useState(false);
  const t = useTranslations("complianceBanner");

  if (dismissed) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 bg-blue-900 text-white border-t border-blue-700 print:hidden">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-3">
          <svg
            className="w-4 h-4 flex-shrink-0 text-blue-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <span>
            <strong className="text-blue-200">{t("hipaaProtected")}</strong>
            <span className="mx-1.5 text-blue-400">|</span>
            {t("tlsEncrypted")}
            <span className="mx-1.5 text-blue-400">|</span>
            {t("aes256AtRest")}
            <span className="mx-1.5 text-blue-400">|</span>
            {t("accessAudited")}
            <span className="mx-1.5 text-blue-400">|</span>
            {t("noCopyPhi")}
          </span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-blue-300 hover:text-white transition-colors flex-shrink-0"
          aria-label={t("dismiss")}
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
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
