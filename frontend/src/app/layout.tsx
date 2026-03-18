import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import "./globals.css";
import { OrganizationProvider } from "./context/OrganizationContext";
import { AppHeader } from "./components/AppHeader";
import { OnboardingModalWrapper } from "./components/OnboardingModalWrapper";
import { CookieConsentBanner } from "./components/CookieConsentBanner";
import { PageLoadingIndicator } from "./components/PageLoadingIndicator";
import InactivityGuard from "./components/InactivityGuard";
import ComplianceBanner from "./components/ComplianceBanner";
import DataProtectionGuard from "./components/DataProtectionGuard";
import PendingApprovalBanner from "./components/PendingApprovalBanner";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <ClerkProvider appearance={{ baseTheme: dark }}>
      <html lang={locale}>
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin=""
          />
          <link
            href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
            rel="stylesheet"
          />
        </head>
        <body className="font-inter antialiased">
          <PageLoadingIndicator />
          <NextIntlClientProvider locale={locale} messages={messages}>
            <OrganizationProvider>
              <AppHeader />
              {children}
              {/* Render onboarding modal at root level so it's not constrained by header */}
              <OnboardingModalWrapper />
              {/* Cookie consent banner */}
              <CookieConsentBanner />
              {/* HIPAA: auto-logout after 5 min inactivity */}
              <InactivityGuard />
              {/* HIPAA: compliance reminder footer */}
              <ComplianceBanner />
              {/* HIPAA: prevent casual data exfiltration */}
              <DataProtectionGuard />
              {/* Org security: block access until admin approves membership */}
              <PendingApprovalBanner />
            </OrganizationProvider>
          </NextIntlClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
