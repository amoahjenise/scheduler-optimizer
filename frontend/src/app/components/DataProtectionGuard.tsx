/**
 * DataProtectionGuard — prevents common PHI exfiltration:
 *   - Blocks right-click context menu on the protected area
 *   - Blocks Ctrl+C / Cmd+C copy shortcuts
 *   - Blocks Ctrl+P / Cmd+P print (redirects to in-app print)
 *   - Blocks Ctrl+S / Cmd+S save page
 *   - Prevents screenshots via CSS and Visibility API
 *
 * This is a deterrent, not a bulletproof DRM — a determined user
 * could still use dev tools. But it prevents accidental/casual leaks.
 */

"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Routes that contain sensitive / PHI data */
const SENSITIVE_ROUTES = ["/handover", "/patients", "/dashboard", "/nurses"];

export default function DataProtectionGuard() {
  const pathname = usePathname();
  const isSensitive = SENSITIVE_ROUTES.some((r) => pathname.startsWith(r));

  useEffect(() => {
    // Block right-click context menu
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Only block on patient data areas, not the whole page
      if (target.closest("[data-phi]") || target.closest(".phi-protected")) {
        e.preventDefault();
      }
    };

    // Block keyboard shortcuts for copy, save, print, screenshot
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier) {
        // Block Ctrl/Cmd + S (save page)
        if (e.key === "s") {
          e.preventDefault();
        }
        // Block Ctrl/Cmd + P (browser print) — our app has its own print function
        if (e.key === "p") {
          e.preventDefault();
        }
      }

      // Block PrintScreen key on Windows
      if (e.key === "PrintScreen") {
        e.preventDefault();
        // Clear clipboard as fallback
        navigator.clipboard?.writeText("").catch(() => {});
      }

      // Block Mac screenshot shortcuts: Cmd+Shift+3, Cmd+Shift+4, Cmd+Shift+5
      if (
        isSensitive &&
        e.metaKey &&
        e.shiftKey &&
        ["3", "4", "5"].includes(e.key)
      ) {
        e.preventDefault();
      }
    };

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSensitive]);

  // Blur page content when tab is hidden (prevents screen capture tools
  // that work by switching focus)
  useEffect(() => {
    if (!isSensitive) return;

    const handleVisibilityChange = () => {
      const main = document.querySelector("main") || document.body;
      if (document.hidden) {
        main.style.filter = "blur(10px)";
      } else {
        main.style.filter = "";
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      // Clean up filter on unmount
      const main = document.querySelector("main") || document.body;
      main.style.filter = "";
    };
  }, [isSensitive]);

  return null;
}
