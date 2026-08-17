"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  Bell,
  Shield,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  RefreshCw,
  Activity,
} from "lucide-react";
import { useOrganization } from "../context/OrganizationContext";
import {
  fetchBurnoutDashboardAPI,
  fetchBurnoutNurseDetailAPI,
  runBurnoutAssessmentAPI,
  fetchBurnoutAlertsAPI,
  acknowledgeBurnoutAlertAPI,
  type BurnoutDashboard,
  type BurnoutNurseDetail,
  type BurnoutAlert,
  type BurnoutSnapshot,
  type BurnoutTopRiskItem,
  type BurnoutRiskBucketItem,
} from "../lib/api";

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-700 border-green-200",
  moderate: "bg-yellow-100 text-yellow-700 border-yellow-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  critical: "bg-red-100 text-red-700 border-red-200",
};

const RISK_BAR_COLORS: Record<string, string> = {
  low: "bg-green-500",
  moderate: "bg-yellow-500",
  high: "bg-orange-500",
  critical: "bg-red-500",
};

const TREND_ICONS: Record<string, React.ReactNode> = {
  improving: <TrendingDown className="w-4 h-4 text-green-500" />,
  stable: <Minus className="w-4 h-4 text-gray-400" />,
  worsening: <TrendingUp className="w-4 h-4 text-red-500" />,
};

const FACTOR_LABELS: Record<string, string> = {
  overtime: "Overtime",
  schedule_density: "Schedule Density",
  night_shift_load: "Night Shifts",
  weekend_load: "Weekend Load",
  short_rest: "Short Rest Periods",
  pattern_disruption: "Pattern Disruption",
  tenure_risk: "Tenure Risk",
};

export default function BurnoutPredictorPage() {
  const { getAuthHeaders, canManage } = useOrganization();
  const t = useTranslations("burnout");

  const [dashboard, setDashboard] = useState<BurnoutDashboard | null>(null);
  const [alerts, setAlerts] = useState<BurnoutAlert[]>([]);
  const [selectedNurse, setSelectedNurse] = useState<BurnoutNurseDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [assessing, setAssessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alertsExpanded, setAlertsExpanded] = useState(true);
  const [tab, setTab] = useState<"overview" | "alerts">("overview");

  const loadDashboard = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const [dashData, alertData] = await Promise.all([
        fetchBurnoutDashboardAPI(headers),
        fetchBurnoutAlertsAPI({ acknowledged: false }, headers),
      ]);
      setDashboard(dashData);
      setAlerts(alertData);
    } catch {
      // Silently handle
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const runAssessment = async () => {
    setAssessing(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      await runBurnoutAssessmentAPI(undefined, headers);
      await loadDashboard();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAssessing(false);
    }
  };

  const acknowledgeAlert = async (alertId: string) => {
    try {
      const headers = await getAuthHeaders();
      await acknowledgeBurnoutAlertAPI(alertId, undefined, headers);
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const viewNurseDetail = async (nurseId: string) => {
    try {
      const headers = await getAuthHeaders();
      const detail = await fetchBurnoutNurseDetailAPI(
        nurseId,
        undefined,
        headers,
      );
      setSelectedNurse(detail);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const riskDistributionBar = () => {
    if (!dashboard) return null;
    const dist = dashboard.risk_distribution;
    const total = dist.low + dist.moderate + dist.high + dist.critical;
    if (total === 0) return null;
    return (
      <div className="flex rounded-full h-4 overflow-hidden">
        {dist.low > 0 && (
          <div
            className="bg-green-400"
            style={{ width: `${(dist.low / total) * 100}%` }}
          />
        )}
        {dist.moderate > 0 && (
          <div
            className="bg-yellow-400"
            style={{ width: `${(dist.moderate / total) * 100}%` }}
          />
        )}
        {dist.high > 0 && (
          <div
            className="bg-orange-400"
            style={{ width: `${(dist.high / total) * 100}%` }}
          />
        )}
        {dist.critical > 0 && (
          <div
            className="bg-red-400"
            style={{ width: `${(dist.critical / total) * 100}%` }}
          />
        )}
      </div>
    );
  };

  const renderFactorBars = (snapshot: BurnoutSnapshot) => {
    const factors = [
      { key: "overtime", value: snapshot.overtime_score ?? 0 },
      { key: "schedule_density", value: snapshot.schedule_density_score ?? 0 },
      { key: "night_shift_load", value: snapshot.night_shift_load_score ?? 0 },
      { key: "weekend_load", value: snapshot.weekend_load_score ?? 0 },
      { key: "short_rest", value: snapshot.short_rest_score ?? 0 },
      {
        key: "pattern_disruption",
        value: snapshot.pattern_disruption_score ?? 0,
      },
      { key: "tenure_risk", value: snapshot.tenure_risk_score ?? 0 },
    ].sort((a, b) => b.value - a.value);

    return (
      <div className="space-y-3">
        {factors.map(({ key, value }) => (
          <div key={key}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">{FACTOR_LABELS[key]}</span>
              <span className="text-gray-900 font-medium">
                {Math.round(value * 100)}%
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full transition-all ${value >= 0.75 ? "bg-red-500" : value >= 0.5 ? "bg-orange-500" : value >= 0.25 ? "bg-yellow-500" : "bg-green-500"}`}
                style={{ width: `${value * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (!canManage) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 py-10">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h1 className="text-xl font-semibold text-gray-900 mb-2">
              Access restricted
            </h1>
            <p className="text-sm text-gray-600 mb-4">
              Burnout insights are available to managers and admins only.
            </p>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Nurse Detail View
  if (selectedNurse) {
    const snap = selectedNurse.current_snapshot;
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <button
            onClick={() => setSelectedNurse(null)}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
          >
            <ArrowLeft className="w-4 h-4" /> {t("backToDashboard")}
          </button>

          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  {selectedNurse.nurse_name}
                </h1>
                <p className="text-sm text-gray-500">{t("nurseDetail")}</p>
              </div>
              {snap && (
                <div
                  className={`px-4 py-2 rounded-full border text-sm font-semibold ${RISK_COLORS[snap.risk_level]}`}
                >
                  {snap.risk_level.toUpperCase()} –{" "}
                  {Math.round(snap.overall_risk_score * 100)}%
                </div>
              )}
            </div>

            {snap && (
              <>
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
                  {snap.trend && TREND_ICONS[snap.trend]} {t("trend")}:{" "}
                  {snap.trend ?? "unknown"}
                  <span className="text-gray-300">·</span>
                  {t("assessed")}:{" "}
                  {new Date(snap.snapshot_date).toLocaleDateString()}
                </div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                  {t("riskFactorBreakdown")}
                </h3>
                {renderFactorBars(snap)}
              </>
            )}
          </div>

          {/* History */}
          {selectedNurse.history.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">
                {t("assessmentHistory")}
              </h3>
              <div className="space-y-2">
                {selectedNurse.history.map((h, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0"
                  >
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${RISK_BAR_COLORS[h.risk_level]}`}
                    />
                    <span className="text-sm text-gray-900 font-medium w-16">
                      {Math.round(h.overall_risk_score * 100)}%
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${RISK_COLORS[h.risk_level]}`}
                    >
                      {h.risk_level}
                    </span>
                    <span className="text-xs text-gray-400 ml-auto">
                      {new Date(h.snapshot_date).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Main Dashboard
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
            <p className="text-gray-500 mt-1">{t("subtitle")}</p>
          </div>
          {canManage && (
            <button
              onClick={runAssessment}
              disabled={assessing}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {assessing ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Activity className="w-4 h-4" />
              )}
              {t("runAssessment")}
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          <button
            onClick={() => setTab("overview")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === "overview" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            <Users className="w-4 h-4 inline mr-1.5" /> {t("overview")}
          </button>
          <button
            onClick={() => setTab("alerts")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors relative ${tab === "alerts" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            <Bell className="w-4 h-4 inline mr-1.5" /> {t("alerts")}
            {alerts.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                {alerts.length}
              </span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-32 bg-white rounded-xl border border-gray-200 animate-pulse"
              />
            ))}
          </div>
        ) : tab === "overview" ? (
          <>
            {/* Summary Cards */}
            {dashboard && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {(["low", "moderate", "high", "critical"] as const).map(
                  (level) => {
                    const nurses = dashboard.risk_buckets?.[level] ?? [];
                    const previewNurses = nurses.slice(0, 10);
                    const remaining = nurses.length - previewNurses.length;

                    return (
                    <div
                      key={level}
                      className="group relative bg-white rounded-xl border border-gray-200 p-4"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`w-3 h-3 rounded-full ${RISK_BAR_COLORS[level]}`}
                        />
                        <span className="text-xs font-medium text-gray-500 uppercase">
                          {level}
                        </span>
                      </div>
                      <p className="text-3xl font-bold text-gray-900">
                        {dashboard.risk_distribution[level]}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {t("nurses")}
                      </p>

                      {nurses.length > 0 && (
                        <div className="hidden group-hover:block group-focus-within:block absolute z-20 left-2 right-2 top-full mt-2 rounded-lg border border-gray-200 bg-white shadow-lg p-2">
                          <p className="text-[11px] font-semibold uppercase text-gray-500 mb-1">
                            {level} {t("nurses")}
                          </p>
                          <div className="max-h-48 overflow-y-auto space-y-1">
                            {previewNurses.map((nurse: BurnoutRiskBucketItem) => (
                              <button
                                key={nurse.nurse_id}
                                onClick={() => viewNurseDetail(nurse.nurse_id)}
                                className="w-full text-left text-xs px-2 py-1 rounded hover:bg-gray-50"
                              >
                                <span className="text-gray-800">
                                  {nurse.nurse_name}
                                </span>
                                <span className="text-gray-400 ml-2">
                                  {Math.round(nurse.overall_risk_score * 100)}%
                                </span>
                              </button>
                            ))}
                            {remaining > 0 && (
                              <p className="text-[11px] text-gray-400 px-2 py-1">
                                +{remaining} more
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  },
                )}
              </div>
            )}

            {/* Distribution Bar */}
            {dashboard && (
              <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                  {t("riskDistribution")}
                </h3>
                {riskDistributionBar()}
                <div className="flex justify-between text-xs text-gray-400 mt-2">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-green-400 rounded-full" />{" "}
                    {t("low")}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-yellow-400 rounded-full" />{" "}
                    {t("moderate")}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-orange-400 rounded-full" />{" "}
                    {t("high")}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-red-400 rounded-full" />{" "}
                    {t("critical")}
                  </span>
                </div>
              </div>
            )}

            {/* Top-Risk Nurses */}
            {dashboard && dashboard.top_risks.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                  {t("topRiskNurses")}
                </h3>
                <div className="space-y-2">
                  {dashboard.top_risks.map((nurse: BurnoutTopRiskItem) => (
                    <button
                      key={nurse.id}
                      onClick={() => viewNurseDetail(nurse.nurse_id)}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-colors text-left"
                    >
                      <span
                        className={`w-3 h-3 rounded-full flex-shrink-0 ${RISK_BAR_COLORS[nurse.risk_level]}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {nurse.nurse_name}
                        </p>
                        <p className="text-xs text-gray-400">
                          {nurse.risk_level} ·{" "}
                          {nurse.trend && TREND_ICONS[nurse.trend]}{" "}
                          {nurse.trend ?? ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-gray-900">
                          {Math.round(nurse.overall_risk_score * 100)}%
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {dashboard && dashboard.top_risks.length === 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <Shield className="w-12 h-12 text-green-400 mx-auto mb-3" />
                <p className="text-gray-500">{t("noRiskData")}</p>
                <p className="text-sm text-gray-400 mt-1">
                  {t("runAssessmentHint")}
                </p>
              </div>
            )}
          </>
        ) : (
          /* Alerts Tab */
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200">
              <button
                onClick={() => setAlertsExpanded(!alertsExpanded)}
                className="w-full flex items-center justify-between p-4"
              >
                <h3 className="text-sm font-semibold text-gray-700">
                  {t("activeAlerts")} ({alerts.length})
                </h3>
                {alertsExpanded ? (
                  <ChevronUp className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                )}
              </button>
              {alertsExpanded && (
                <div className="border-t border-gray-100">
                  {alerts.length === 0 ? (
                    <div className="p-8 text-center">
                      <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">{t("noAlerts")}</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-50">
                      {alerts.map((alert) => (
                        <div
                          key={alert.id}
                          className="p-4 flex items-start gap-3"
                        >
                          <AlertTriangle
                            className={`w-5 h-5 flex-shrink-0 mt-0.5 ${alert.severity === "critical" ? "text-red-500" : "text-orange-500"}`}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">
                              {alert.message}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                              {t("triggeredAt")}:{" "}
                              {new Date(alert.created_at).toLocaleString()}
                            </p>
                          </div>
                          <button
                            onClick={() => acknowledgeAlert(alert.id)}
                            className="flex-shrink-0 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md transition-colors"
                          >
                            {t("acknowledge")}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
