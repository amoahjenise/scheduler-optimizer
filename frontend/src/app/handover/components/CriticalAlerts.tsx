/**
 * CriticalAlerts — shows red alert badges on the handover patient list
 * for clinically dangerous conditions: neutropenic ANC, active chemo,
 * critical acuity, or neutropenic isolation.
 */
import type { Handover } from "../../lib/api";

interface CriticalAlertsProps {
  handover: Handover | undefined;
}

interface Alert {
  label: string;
  color: string;
  bgColor: string;
}

export function getCriticalAlerts(handover: Handover | undefined): Alert[] {
  if (!handover) return [];

  const alerts: Alert[] = [];

  // ANC < 500 — neutropenic precautions
  if (handover.anc) {
    const ancNum = parseFloat(handover.anc.replace(/[^0-9.]/g, ""));
    if (!isNaN(ancNum) && ancNum < 500) {
      alerts.push({
        label: `ANC ${handover.anc}`,
        color: "text-red-700",
        bgColor: "bg-red-100",
      });
    }
  }

  // Neutropenic isolation
  if (handover.isolation === "neutropenic") {
    alerts.push({
      label: "Neutropenic",
      color: "text-red-700",
      bgColor: "bg-red-100",
    });
  }

  // Critical acuity
  if (handover.acuity === "critical") {
    alerts.push({
      label: "Critical",
      color: "text-red-700",
      bgColor: "bg-red-100",
    });
  } else if (handover.acuity === "high") {
    alerts.push({
      label: "High Acuity",
      color: "text-orange-700",
      bgColor: "bg-orange-100",
    });
  }

  // Active chemotherapy
  if (
    handover.chemotherapies &&
    handover.chemotherapies.trim() &&
    handover.chemotherapies.toLowerCase() !== "none" &&
    handover.chemotherapies.toLowerCase() !== "n/a"
  ) {
    alerts.push({
      label: "Active Chemo",
      color: "text-purple-700",
      bgColor: "bg-purple-100",
    });
  }

  // Active infusions
  if (
    handover.iv_infusions &&
    handover.iv_infusions.trim() &&
    handover.iv_infusions.toLowerCase() !== "none"
  ) {
    alerts.push({
      label: "Infusion",
      color: "text-blue-700",
      bgColor: "bg-blue-100",
    });
  }

  // Low platelets (< 50k) — bleeding risk
  if (handover.plt) {
    const pltNum = parseFloat(handover.plt.replace(/[^0-9.]/g, ""));
    if (!isNaN(pltNum) && pltNum < 50) {
      alerts.push({
        label: `PLT ${handover.plt}`,
        color: "text-orange-700",
        bgColor: "bg-orange-100",
      });
    }
  }

  return alerts;
}

export default function CriticalAlerts({ handover }: CriticalAlertsProps) {
  const alerts = getCriticalAlerts(handover);

  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {alerts.map((alert, i) => (
        <span
          key={i}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded ${alert.bgColor} ${alert.color}`}
        >
          <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          {alert.label}
        </span>
      ))}
    </div>
  );
}
