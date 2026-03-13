"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import "./globals.css";
import { OrganizationProvider } from "./context/OrganizationContext";
import { AppHeader } from "./components/AppHeader";
import { OnboardingModalWrapper } from "./components/OnboardingModalWrapper";
import { CookieConsentBanner } from "./components/CookieConsentBanner";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider appearance={{ baseTheme: dark }}>
      <html lang="en">
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
          <OrganizationProvider>
            <AppHeader />
            {children}
            {/* Render onboarding modal at root level so it's not constrained by header */}
            <OnboardingModalWrapper />
            {/* Cookie consent banner */}
            <CookieConsentBanner />
          </OrganizationProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
