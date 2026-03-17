/**
 * Feature flags for enabling/disabling application features.
 * Toggle these to control feature visibility across the app.
 *
 * To re-enable a feature, simply set its flag to `true`.
 */

export const FEATURES = {
  /**
   * Patient Management page (/patients) and related UI.
   *
   * Disabled as part of HIPAA compliance work — patient demographics are now
   * embedded directly on hand-off reports (p_* fields). The standalone patient
   * roster page is no longer needed for day-to-day workflow.
   *
   * Re-enable once the patient list view is fully decoupled from the patients
   * API, or if a standalone patient census feature is explicitly required.
   */
  PATIENT_MANAGEMENT: false,
} as const;
