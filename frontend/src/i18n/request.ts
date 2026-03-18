import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { defaultLocale, locales, type Locale } from "./config";

export default getRequestConfig(async () => {
  // Try to get locale from cookie first
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("NEXT_LOCALE")?.value as
    | Locale
    | undefined;

  // Priority: 1) Cookie, 2) Accept-Language header, 3) Default locale (fr)
  let locale: Locale = defaultLocale;

  if (localeCookie && locales.includes(localeCookie)) {
    // User explicitly selected a language via the switcher
    locale = localeCookie;
  } else {
    // No cookie set - check Accept-Language header for first-time visitors
    const headerStore = await headers();
    const acceptLanguage = headerStore.get("accept-language");
    if (acceptLanguage) {
      // Parse Accept-Language header
      const preferredLocale = acceptLanguage
        .split(",")
        .map((lang) => lang.split(";")[0].trim().substring(0, 2))
        .find((lang) => locales.includes(lang as Locale)) as Locale | undefined;

      if (preferredLocale) {
        locale = preferredLocale;
      }
    }
    // If no valid Accept-Language, locale remains as defaultLocale (fr)
  }

  // Log for debugging - remove in production
  console.log(
    "[i18n/request] Resolved locale:",
    locale,
    "Cookie:",
    localeCookie || "none",
  );

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
