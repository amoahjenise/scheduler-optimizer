"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { clearSensitiveData } from "../lib/sessionCleanup";

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const WARNING_BEFORE_MS = 60 * 1000; // Show warning 1 minute before logout
const WARNING_AT_MS = INACTIVITY_TIMEOUT_MS - WARNING_BEFORE_MS;
const SIGNOUT_INFO_KEY = "hipaa-signout-info";

/**
 * InactivityGuard — HIPAA-compliant auto-logout.
 *
 * After 5 minutes of no mouse / keyboard / touch activity the user is
 * automatically signed out and all client-side state is wiped.
 * A warning dialog appears at 4 minutes giving a 60-second countdown.
 *
 * If the user returns during the countdown, the timer PAUSES and a
 * "Still here?" prompt asks them to click Resume to continue their session.
 *
 * After auto-signout, a notification box shows the sign-out time and reason.
 */
export default function InactivityGuard() {
  const { signOut, isSignedIn } = useAuth();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [isPaused, setIsPaused] = useState(false);

  // Post-signout notification (persists across redirect via localStorage)
  const [signoutInfo, setSignoutInfo] = useState<{
    time: string;
    reason: string;
  } | null>(null);

  // Refs so event handlers always see latest state
  const showWarningRef = useRef(false);
  const isPausedRef = useRef(false);

  useEffect(() => {
    showWarningRef.current = showWarning;
  }, [showWarning]);
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  const clearAllTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  const doLogout = useCallback(async () => {
    clearAllTimers();
    setShowWarning(false);
    setIsPaused(false);

    // Persist signout info so we can show it after redirect
    const info = {
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      reason:
        "Your session was automatically ended due to inactivity to protect patient data (HIPAA compliance).",
    };
    try {
      localStorage.setItem(SIGNOUT_INFO_KEY, JSON.stringify(info));
    } catch {
      /* localStorage may be unavailable */
    }

    clearSensitiveData();
    await signOut({ redirectUrl: "/" });
  }, [signOut, clearAllTimers]);

  const pauseCountdown = useCallback(() => {
    // Stop the countdown interval and the hard-logout timer
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsPaused(true);
  }, []);

  const resetTimers = useCallback(() => {
    clearAllTimers();
    setShowWarning(false);
    setSecondsLeft(60);
    setIsPaused(false);

    // Set warning timer (fires at 4 min)
    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      setSecondsLeft(60);
      // Start countdown
      countdownRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            clearInterval(countdownRef.current!);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, WARNING_AT_MS);

    // Set logout timer (fires at 5 min)
    timerRef.current = setTimeout(() => {
      doLogout();
    }, INACTIVITY_TIMEOUT_MS);
  }, [clearAllTimers, doLogout]);

  // ── Check for stored signout info on mount (post-redirect notification) ──
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIGNOUT_INFO_KEY);
      if (stored) {
        setSignoutInfo(JSON.parse(stored));
        localStorage.removeItem(SIGNOUT_INFO_KEY);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // ── Clear stale signout info once the user signs back in ──
  useEffect(() => {
    if (isSignedIn) {
      setSignoutInfo(null);
      try {
        localStorage.removeItem(SIGNOUT_INFO_KEY);
      } catch {
        /* ignore */
      }
    }
  }, [isSignedIn]);

  // ── Activity listeners ──
  useEffect(() => {
    if (!isSignedIn) return;

    const activityEvents = [
      "mousedown",
      "mousemove",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];

    const handleActivity = () => {
      if (showWarningRef.current && !isPausedRef.current) {
        // Warning countdown is running → pause and ask for confirmation
        pauseCountdown();
      } else if (!showWarningRef.current) {
        // No warning active → silently reset inactivity timer
        resetTimers();
      }
      // If already paused, do nothing — wait for explicit Resume click
    };

    activityEvents.forEach((event) =>
      window.addEventListener(event, handleActivity, { passive: true }),
    );
    resetTimers();

    return () => {
      activityEvents.forEach((event) =>
        window.removeEventListener(event, handleActivity),
      );
      clearAllTimers();
    };
  }, [isSignedIn, resetTimers, clearAllTimers, pauseCountdown]);

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER — three mutually-exclusive dialogs
  // ═══════════════════════════════════════════════════════════════════

  // 1️⃣  Post-signout notification (shown only on the landing page while signed out)
  if (signoutInfo && !isSignedIn) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden">
          {/* Amber header */}
          <div className="bg-amber-500 px-6 py-4">
            <div className="flex items-center gap-3">
              <svg
                className="w-6 h-6 text-white flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <h2 className="text-lg font-semibold text-white">
                Session Ended
              </h2>
            </div>
          </div>

          <div className="px-6 py-5">
            {/* Timestamp */}
            <div className="flex items-center gap-2 mb-3">
              <svg
                className="w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="text-sm font-medium text-gray-600">
                Signed out at {signoutInfo.time}
              </span>
            </div>

            <p className="text-gray-700 text-sm leading-relaxed mb-5">
              {signoutInfo.reason}
            </p>

            <button
              onClick={() => setSignoutInfo(null)}
              className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isSignedIn || !showWarning) return null;

  // 2️⃣  Paused — "Are you still here?" prompt
  if (isPaused) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden">
          {/* Blue header */}
          <div className="bg-blue-600 px-6 py-4">
            <div className="flex items-center gap-3">
              <svg
                className="w-6 h-6 text-white flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <h2 className="text-lg font-semibold text-white">Still Here?</h2>
            </div>
          </div>

          <div className="px-6 py-5">
            <p className="text-gray-700 text-sm leading-relaxed mb-2">
              Your session was about to expire due to inactivity.
            </p>
            <p className="text-gray-500 text-xs mb-5">
              Click <strong>Resume</strong> to continue your session, or sign
              out now.
            </p>

            {/* Frozen countdown ring (visual indicator of where it stopped) */}
            <div className="flex items-center justify-center mb-5">
              <div className="relative w-16 h-16">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                  <path
                    d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#dbeafe"
                    strokeWidth="3"
                  />
                  <path
                    d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="3"
                    strokeDasharray={`${(secondsLeft / 60) * 100}, 100`}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-blue-600">
                  {secondsLeft}
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={resetTimers}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Resume
              </button>
              <button
                onClick={doLogout}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3️⃣  Active countdown — session expiring warning
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden">
        {/* Red header bar */}
        <div className="bg-red-600 px-6 py-4">
          <div className="flex items-center gap-3">
            <svg
              className="w-6 h-6 text-white flex-shrink-0"
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
            <h2 className="text-lg font-semibold text-white">
              Session Expiring
            </h2>
          </div>
        </div>

        <div className="px-6 py-5">
          <p className="text-gray-700 text-sm leading-relaxed">
            For patient data security, your session will end due to inactivity.
          </p>

          {/* Countdown */}
          <div className="flex items-center justify-center my-5">
            <div className="relative w-20 h-20">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
                <path
                  d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="#fee2e2"
                  strokeWidth="3"
                />
                <path
                  d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="3"
                  strokeDasharray={`${(secondsLeft / 60) * 100}, 100`}
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-red-600">
                {secondsLeft}
              </span>
            </div>
          </div>

          <p className="text-xs text-gray-500 text-center mb-4">
            Move your mouse or press any key to stay signed in.
          </p>

          <div className="flex gap-3">
            <button
              onClick={resetTimers}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Stay Signed In
            </button>
            <button
              onClick={doLogout}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Sign Out Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
