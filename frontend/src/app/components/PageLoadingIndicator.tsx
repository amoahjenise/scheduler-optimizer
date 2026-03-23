"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function PageLoadingIndicator() {
  const [isLoading, setIsLoading] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clear loading when route finishes navigating
  useEffect(() => {
    setIsLoading(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, [pathname, searchParams]);

  // Intercept all <a> clicks that are client-side navigations
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (
        !href ||
        href.startsWith("http") ||
        href.startsWith("#") ||
        href.startsWith("mailto:")
      )
        return;

      // Only for same-origin internal links
      if (anchor.target === "_blank") return;
      // Check if modifier keys are held (open in new tab)
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;

      // This is a client-side navigation — show loading immediately
      setIsLoading(true);

      // Safety timeout: clear loading after 8s in case navigation is very slow
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setIsLoading(false), 8000);
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  // Also handle programmatic navigation via button clicks that look like nav
  useEffect(() => {
    const handleBeforeUnload = () => setIsLoading(true);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  if (!isLoading) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-0.5">
      <div className="h-full bg-gradient-to-r from-blue-500 via-blue-600 to-blue-400 animate-loading-bar" />
      <style jsx>{`
        @keyframes loadingBar {
          0% {
            width: 0%;
          }
          20% {
            width: 30%;
          }
          50% {
            width: 60%;
          }
          80% {
            width: 85%;
          }
          100% {
            width: 95%;
          }
        }
        .animate-loading-bar {
          animation: loadingBar 2s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
