/**
 * LabTrendBanner — compares current handover labs with the previous shift
 * and displays a clinical alert when critical values are trending down
 * (e.g., platelets dropping, ANC falling).
 */

import type { Handover } from "../../lib/api";

interface LabTrendBannerProps {
  current: Handover;
  previous: Handover | null;
}

interface LabTrend {
  label: string;
  field: string;
  currentVal: number;
  previousVal: number;
  unit: string;
  direction: "falling" | "rising";
  severity: "warning" | "danger";
}

function parseLabValue(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const num = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return isNaN(num) ? null : num;
}

export default function LabTrendBanner({
  current,
  previous,
}: LabTrendBannerProps) {
  if (!previous) return null;

  const trends: LabTrend[] = [];

  // Define labs to track: [fieldKey, displayLabel, unit, dangerThreshold, warnOnFall]
  const labDefs: [keyof Handover, string, string, number, boolean][] = [
    ["plt", "Platelets", "K", 50, true], // falling below 50 is dangerous
    ["anc", "ANC", "", 500, true], // ANC < 500 = neutropenic
    ["hgb", "Hemoglobin", "g/dL", 7, true], // Hgb < 7 often triggers transfusion
    ["wbc", "WBC", "K", 1.0, true], // Very low WBC
  ];

  for (const [field, label, unit, dangerThreshold, warnOnFall] of labDefs) {
    const currVal = parseLabValue(current[field] as string);
    const prevVal = parseLabValue(previous[field] as string);
    if (currVal == null || prevVal == null) continue;

    const isFalling = currVal < prevVal;
    const isRising = currVal > prevVal;

    if (warnOnFall && isFalling) {
      const severity = currVal < dangerThreshold ? "danger" : "warning";
      trends.push({
        label,
        field: field as string,
        currentVal: currVal,
        previousVal: prevVal,
        unit,
        direction: "falling",
        severity,
      });
    }

    // Rising WBC could indicate infection
    if (field === "wbc" && isRising && currVal > 15) {
      trends.push({
        label: "WBC",
        field: "wbc",
        currentVal: currVal,
        previousVal: prevVal,
        unit: "K",
        direction: "rising",
        severity: "warning",
      });
    }
  }

  if (trends.length === 0) return null;

  const hasDanger = trends.some((t) => t.severity === "danger");

  return (
    <div
      className={`rounded-lg border px-4 py-3 mb-4 ${
        hasDanger ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"
      }`}
    >
      <div className="flex items-start gap-2">
        <svg
          className={`w-5 h-5 flex-shrink-0 mt-0.5 ${hasDanger ? "text-red-600" : "text-amber-600"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
          />
        </svg>
        <div>
          <p
            className={`text-sm font-semibold ${hasDanger ? "text-red-800" : "text-amber-800"}`}
          >
            Lab Trend Alert
          </p>
          <div className="mt-1 space-y-1">
            {trends.map((trend) => (
              <p
                key={trend.field}
                className={`text-xs ${trend.severity === "danger" ? "text-red-700" : "text-amber-700"}`}
              >
                <span className="font-medium">{trend.label}</span>{" "}
                {trend.direction === "falling" ? "↓" : "↑"} {trend.previousVal}
                {trend.unit} → {trend.currentVal}
                {trend.unit}
                {trend.severity === "danger" && (
                  <span className="ml-1 font-semibold">(Critical)</span>
                )}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
