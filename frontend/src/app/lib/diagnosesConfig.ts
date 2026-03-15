/**
 * Diagnoses configuration management
 * Allows admin users to configure the default diagnosis suggestions
 * shown in hand-off report creation and patient modals.
 *
 * Stored in localStorage; follows the same pattern as teamsConfig / roomsConfig.
 */

const STORAGE_KEY = "patient_diagnoses_config";

export const DEFAULT_DIAGNOSES: string[] = [
  "ALL (Acute Lymphoblastic Leukemia)",
  "AML (Acute Myeloid Leukemia)",
  "Neuroblastoma",
  "Hodgkin Lymphoma",
  "Non-Hodgkin Lymphoma",
  "Brain Tumor",
  "Osteosarcoma",
  "Ewing Sarcoma",
  "Wilms Tumor",
  "Rhabdomyosarcoma",
  "Retinoblastoma",
  "Sickle Cell Disease",
  "Aplastic Anemia",
  "Hemophilia",
  "Thalassemia",
  "BMT - Auto",
  "BMT - Allo",
  "SCIDS",
];

function normalize(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_DIAGNOSES];
  const cleaned = value
    .map((d) => (typeof d === "string" ? d.trim() : ""))
    .filter((d) => d.length > 0);
  if (!cleaned.length) return [...DEFAULT_DIAGNOSES];
  // De-duplicate while preserving order
  return Array.from(new Set(cleaned));
}

export function loadDiagnoses(): string[] {
  if (typeof window === "undefined") return [...DEFAULT_DIAGNOSES];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_DIAGNOSES];
    return normalize(JSON.parse(raw));
  } catch {
    return [...DEFAULT_DIAGNOSES];
  }
}

export function saveDiagnoses(diagnoses: string[]): string[] {
  const normalized = normalize(diagnoses);
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("diagnosesConfigChanged"));
  }
  return normalized;
}

export function addDiagnosis(diagnosis: string): string[] {
  const trimmed = diagnosis.trim();
  if (!trimmed) return loadDiagnoses();
  const current = loadDiagnoses();
  // Check for case-insensitive duplicate
  if (current.some((d) => d.toLowerCase() === trimmed.toLowerCase())) {
    return current;
  }
  return saveDiagnoses([...current, trimmed]);
}

export function removeDiagnosis(diagnosis: string): string[] {
  const next = loadDiagnoses().filter((d) => d !== diagnosis);
  return saveDiagnoses(next);
}

export function resetDiagnoses(): string[] {
  return saveDiagnoses([...DEFAULT_DIAGNOSES]);
}
