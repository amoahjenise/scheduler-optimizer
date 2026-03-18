"use client";

import { useState, useEffect } from "react";
import { NextIntlClientProvider } from "next-intl";
import { defaultLocale, locales, type Locale } from "@/i18n/config";
import enMessages from "@/i18n/messages/en.json";
import frMessages from "@/i18n/messages/fr.json";

const messages: Record<Locale, typeof enMessages> = {
  en: enMessages,
  fr: frMessages,
};

function getLocaleFromCookie(): Locale {
  if (typeof document === "undefined") return defaultLocale;
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  const value = match?.[1];
  return (locales as readonly string[]).includes(value ?? "")
    ? (value as Locale)
    : defaultLocale;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(defaultLocale);

  useEffect(() => {
    setLocale(getLocaleFromCookie());
  }, []);

  return (
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {children}
    </NextIntlClientProvider>
  );
}
