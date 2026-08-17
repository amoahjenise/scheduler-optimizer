/**
 * Internationalization Configuration
 *
 * Multi-language support for healthcare accessibility.
 */

export const locales = ["en", "fr"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeNames: Record<Locale, string> = {
  fr: "Français",
  en: "English",
};

export const localeFlags: Record<Locale, string> = {
  fr: "�🇷",
  en: "🇬🇧",
};
