"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";
import { locales, localeNames, localeFlags, type Locale } from "@/i18n/config";
import { Globe } from "lucide-react";

export default function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const [isPending, startTransition] = useTransition();

  const handleLocaleChange = (newLocale: Locale) => {
    startTransition(() => {
      // Set cookie with explicit attributes for server-side access
      document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=31536000;SameSite=Lax`;
      // Reload to apply new locale from server-side
      window.location.reload();
    });
  };

  return (
    <div className="relative group">
      <button
        className="flex items-center gap-1.5 px-2 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
        disabled={isPending}
        title={localeNames[locale]}
      >
        <Globe className="w-4 h-4" />
        <span className="text-base leading-none">{localeFlags[locale]}</span>
      </button>

      <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
        {locales.map((loc) => (
          <button
            key={loc}
            onClick={() => handleLocaleChange(loc)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg ${
              loc === locale
                ? "bg-blue-50 text-blue-700 font-medium"
                : "text-gray-700"
            }`}
            disabled={isPending}
          >
            <span>{localeFlags[loc]}</span>
            <span>{localeNames[loc]}</span>
            {loc === locale && <span className="ml-auto text-blue-600">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
