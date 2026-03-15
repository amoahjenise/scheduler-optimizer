/**
 * CarriedForwardBanner — displays a yellow verification banner inside sections
 * that contain data carried from a previous shift. Requires nurse to verify
 * the data is still current before completing the handover.
 */

"use client";

interface CarriedForwardBannerProps {
  sectionLabel: string;
  verified: boolean;
  onVerify: () => void;
  readOnly?: boolean;
}

export default function CarriedForwardBanner({
  sectionLabel,
  verified,
  onVerify,
  readOnly = false,
}: CarriedForwardBannerProps) {
  if (verified) {
    return (
      <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-md px-3 py-1.5 mb-3 text-xs text-green-700">
        <svg
          className="w-4 h-4 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
        <span>
          <span className="font-semibold">{sectionLabel}</span> — verified as
          current
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between bg-yellow-50 border border-yellow-300 rounded-md px-3 py-2 mb-3">
      <div className="flex items-center gap-2 text-xs text-yellow-800">
        <svg
          className="w-4 h-4 flex-shrink-0 text-yellow-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
        <span>
          <span className="font-semibold">Carried from prior shift</span> —
          please review and verify this data is current
        </span>
      </div>
      {!readOnly && (
        <button
          type="button"
          onClick={onVerify}
          className="ml-3 flex-shrink-0 text-xs font-medium bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1 rounded transition-colors"
        >
          ✓ Verify
        </button>
      )}
    </div>
  );
}
