/**
 * Internationalization Configuration
 *
 * Quebec Law 25 Compliance: French is the primary language
 * Bill S-5 Compliance: Multi-language support for healthcare accessibility
 */

export const locales = ["fr", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "fr"; // French is primary for Quebec

export const localeNames: Record<Locale, string> = {
  fr: "Français",
  en: "English",
};

export const localeFlags: Record<Locale, string> = {
  fr: "🇨🇦",
  en: "🇬🇧",
};
