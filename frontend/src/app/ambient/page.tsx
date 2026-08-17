"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import {
  Mic,
  MicOff,
  FileText,
  CheckCircle,
  XCircle,
  Send,
  Clock,
  AlertTriangle,
  ChevronRight,
  Upload,
  Eye,
  RefreshCw,
  Trash2,
  Play,
  X,
  Volume2,
} from "lucide-react";
import { useOrganization } from "../context/OrganizationContext";
import {
  startAmbientSessionAPI,
  fetchAmbientSessionsAPI,
  submitAmbientTranscriptAPI,
  reviewAmbientSessionAPI,
  commitAmbientSessionAPI,
  discardAmbientSessionAPI,
  type AmbientSession,
} from "../lib/api";

// Web Speech API type declarations
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

const STATUS_COLORS: Record<string, string> = {
  recording: "bg-red-100 text-red-700",
  processing: "bg-yellow-100 text-yellow-700",
  draft: "bg-blue-100 text-blue-700",
  reviewed: "bg-green-100 text-green-700",
  committed: "bg-gray-100 text-gray-600",
  discarded: "bg-gray-100 text-gray-400",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  recording: <Mic className="w-3.5 h-3.5" />,
  processing: <RefreshCw className="w-3.5 h-3.5 animate-spin" />,
  draft: <FileText className="w-3.5 h-3.5" />,
  reviewed: <Eye className="w-3.5 h-3.5" />,
  committed: <CheckCircle className="w-3.5 h-3.5" />,
  discarded: <XCircle className="w-3.5 h-3.5" />,
};

function mapSpeechLocale(locale: string): string {
  const normalized = locale.toLowerCase();
  if (normalized.startsWith("fr")) return "fr-CA";
  return "en-CA";
}

function humanizeAmbientError(message: string): string {
  if (message.includes("No nurse profile is linked")) {
    return "Ambient recording is tied to a nurse profile. Your current account is not linked to a nurse profile in this organization, so recording cannot start. If you are an admin, use a nurse-linked account or link a nurse profile to your own user first.";
  }

  if (message.includes("Nurse profile not found for authenticated user")) {
    return "Ambient recording is tied to a nurse profile. Your current account is not linked to a nurse profile in this organization, so recording cannot start. If you are an admin, use a nurse-linked account or link a nurse profile to your own user first.";
  }

  return message;
}

export default function AmbientDocumentationPage() {
  const { getAuthHeaders } = useOrganization();
  const t = useTranslations("ambient");
  const locale = useLocale();

  const [sessions, setSessions] = useState<AmbientSession[]>([]);
  const [activeSession, setActiveSession] = useState<AmbientSession | null>(
    null,
  );
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [patientMrn, setPatientMrn] = useState("");
  const [interactionType, setInteractionType] = useState("rounds");
  const [selectedSession, setSelectedSession] = useState<AmbientSession | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [micSupported, setMicSupported] = useState(true);
  const [transcriptModalOpen, setTranscriptModalOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Timer
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Speech recognition ref
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Check for speech recognition support
  useEffect(() => {
    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setMicSupported(false);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const data = await fetchAmbientSessionsAPI({}, headers);
      setSessions(data.sessions);
    } catch {
      // Silently handle
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const startRecording = async () => {
    setError(null);

    // Check for browser support
    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setError(
        "Speech recognition is not supported in this browser. Please use Chrome or Edge.",
      );
      return;
    }

    try {
      // Request microphone permission first
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop the tracks immediately - we just needed to check permission
      stream.getTracks().forEach((track) => track.stop());
    } catch (err: any) {
      console.error("Microphone error:", err);

      // Handle specific error types
      if (
        err.name === "NotAllowedError" ||
        err.name === "PermissionDeniedError"
      ) {
        setError(
          "Microphone access denied. Please allow microphone access in your browser settings and try again.",
        );
      } else if (
        err.name === "NotFoundError" ||
        err.name === "DevicesNotFoundError"
      ) {
        setError(
          "No microphone found. Please connect a microphone and try again.",
        );
      } else if (
        err.name === "NotReadableError" ||
        err.name === "TrackStartError"
      ) {
        setError(
          "Microphone is being used by another application. Please close other apps using the microphone and try again.",
        );
      } else if (err.name === "OverconstrainedError") {
        setError(
          "Microphone configuration error. Please check your device settings.",
        );
      } else if (err.name === "SecurityError") {
        setError(
          "Security error: Microphone access requires HTTPS. Please use a secure connection.",
        );
      } else {
        setError(
          `Microphone error: ${err.message || "Unable to access microphone. Please check your browser settings."}`,
        );
      }
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const session = await startAmbientSessionAPI(
        {
          patient_mrn: patientMrn || undefined,
          interaction_type: interactionType,
        },
        headers,
      );
      setActiveSession(session);
      setIsRecording(true);
      setTranscript("");
      setInterimTranscript("");
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);

      // Initialize speech recognition
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = mapSpeechLocale(locale);

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalText = "";
        let interimText = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalText += result[0].transcript + " ";
          } else {
            interimText += result[0].transcript;
          }
        }

        if (finalText) {
          setTranscript((prev) => prev + finalText);
        }
        setInterimTranscript(interimText);
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === "no-speech") {
          // Don't show error for no-speech, just restart
          return;
        }
        setError(`Speech recognition error: ${event.error}`);
      };

      recognition.onend = () => {
        // Restart recognition if still recording (it auto-stops after silence)
        if (isRecording && recognitionRef.current) {
          try {
            recognitionRef.current.start();
          } catch {
            // Ignore if already started
          }
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: unknown) {
      const baseMessage =
        err instanceof Error ? err.message : "Failed to start recording";
      setError(humanizeAmbientError(baseMessage));
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    setInterimTranscript("");
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      const headers = await getAuthHeaders();
      await discardAmbientSessionAPI(sessionId, headers);
      setDeleteConfirmId(null);
      setSelectedSession(null);
      if (activeSession?.id === sessionId) {
        setActiveSession(null);
        stopRecording();
      }
      loadSessions();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete session");
    }
  };

  const submitTranscript = async () => {
    if (!activeSession || !transcript.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const updated = await submitAmbientTranscriptAPI(
        activeSession.id,
        transcript,
        headers,
      );
      setActiveSession(updated);
      setSelectedSession(updated);
      loadSessions();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to submit transcript",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const approveSession = async (sessionId: string) => {
    try {
      const headers = await getAuthHeaders();
      const updated = await reviewAmbientSessionAPI(
        sessionId,
        { approved: true },
        headers,
      );
      setSelectedSession(updated);
      loadSessions();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to approve session",
      );
    }
  };

  const commitSession = async (sessionId: string) => {
    try {
      const headers = await getAuthHeaders();
      const updated = await commitAmbientSessionAPI(sessionId, headers);
      setSelectedSession(updated);
      loadSessions();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to commit session");
    }
  };

  const discardSession = async (sessionId: string) => {
    try {
      const headers = await getAuthHeaders();
      await discardAmbientSessionAPI(sessionId, headers);
      setSelectedSession(null);
      if (activeSession?.id === sessionId) {
        setActiveSession(null);
        setIsRecording(false);
        stopRecording();
      }
      loadSessions();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to discard session",
      );
    }
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const renderExtractedData = (data: Record<string, unknown> | null) => {
    if (!data)
      return (
        <p className="text-gray-400 text-sm italic">{t("noExtractedData")}</p>
      );
    const fields = [
      { key: "chief_complaint", label: t("chiefComplaint") },
      { key: "vital_signs", label: t("vitalSigns") },
      { key: "symptoms", label: t("symptoms") },
      { key: "medications_discussed", label: t("medications") },
      { key: "allergies_mentioned", label: t("allergies") },
      { key: "assessment", label: t("assessment") },
      { key: "plan", label: t("plan") },
      { key: "pain_level", label: t("painLevel") },
      { key: "fall_risk", label: t("fallRisk") },
      { key: "isolation_precautions", label: t("isolation") },
      { key: "labs_ordered", label: t("labsOrdered") },
      { key: "follow_up", label: t("followUp") },
    ];
    return (
      <div className="space-y-2">
        {fields.map(({ key, label }) => {
          const val = data[key];
          if (
            val === null ||
            val === undefined ||
            (Array.isArray(val) && val.length === 0) ||
            (typeof val === "object" &&
              !Array.isArray(val) &&
              Object.keys(val as object).length === 0)
          )
            return null;
          return (
            <div key={key} className="flex gap-2">
              <span className="text-xs font-medium text-gray-500 w-32 flex-shrink-0">
                {label}
              </span>
              <span className="text-sm text-gray-900">
                {Array.isArray(val)
                  ? val.join(", ")
                  : typeof val === "object"
                    ? JSON.stringify(val)
                    : String(val)}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
          <p className="text-gray-500 mt-1">{t("subtitle")}</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Recording Panel */}
          <div className="lg:col-span-2 space-y-6">
            {/* New Session Card */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                {t("newSession")}
              </h2>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Patient MRN/Name
                  </label>
                  <input
                    type="text"
                    value={patientMrn}
                    onChange={(e) => setPatientMrn(e.target.value)}
                    placeholder="e.g., MRN-12345"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={isRecording}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {t("interactionType")}
                  </label>
                  <select
                    value={interactionType}
                    onChange={(e) => setInteractionType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    disabled={isRecording}
                  >
                    <option value="rounds">{t("typeRounds")}</option>
                    <option value="admission">{t("typeAdmission")}</option>
                    <option value="discharge">{t("typeDischarge")}</option>
                    <option value="medication_admin">
                      {t("typeMedication")}
                    </option>
                    <option value="procedure">{t("typeProcedure")}</option>
                  </select>
                </div>
              </div>

              {/* Mic Support Warning */}
              {!micSupported && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-2 text-sm text-yellow-700">
                  <AlertTriangle className="w-4 h-4" />
                  Speech recognition is not supported in this browser. Please
                  use Chrome or Edge, or type the transcript manually.
                </div>
              )}

              {/* Recording Controls */}
              <div className="flex items-center gap-4 mb-4">
                {!isRecording ? (
                  <button
                    onClick={startRecording}
                    disabled={!micSupported}
                    className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-full font-medium transition-colors"
                  >
                    <Mic className="w-5 h-5" /> {t("startSession")}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={stopRecording}
                      className="flex items-center gap-2 px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white rounded-full font-medium transition-colors"
                    >
                      <MicOff className="w-5 h-5" /> {t("stopRecording")}
                    </button>
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                      <Clock className="w-4 h-4" />
                      {formatDuration(elapsed)}
                    </div>
                  </>
                )}
              </div>

              {/* Transcript Input */}
              {activeSession && (
                <div className="mt-4">
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {t("transcriptLabel")}
                    {isRecording && (
                      <span className="ml-2 text-red-500 animate-pulse">
                        ● Recording...
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <textarea
                      value={transcript + interimTranscript}
                      onChange={(e) => setTranscript(e.target.value)}
                      rows={8}
                      placeholder={
                        isRecording
                          ? "Speak now... Your words will appear here."
                          : t("transcriptPlaceholder")
                      }
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                      readOnly={isRecording}
                    />
                    {isRecording && (
                      <div className="absolute bottom-3 right-3 flex items-center gap-1 text-red-500">
                        <Volume2 className="w-4 h-4 animate-pulse" />
                        <span className="text-xs">Listening...</span>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={submitTranscript}
                      disabled={!transcript.trim() || submitting || isRecording}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      {submitting ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      {t("extractEHR")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Session Detail / Extracted Data */}
            {selectedSession && selectedSession.status !== "recording" && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">
                    {t("extractedEHR")}
                  </h2>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[selectedSession.status]}`}
                  >
                    {STATUS_ICONS[selectedSession.status]}
                    {selectedSession.status}
                  </span>
                </div>

                {selectedSession.confidence_score !== null && (
                  <div className="mb-4">
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                      {t("confidence")}:{" "}
                      {Math.round(selectedSession.confidence_score * 100)}%
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${selectedSession.confidence_score >= 0.8 ? "bg-green-500" : selectedSession.confidence_score >= 0.5 ? "bg-yellow-500" : "bg-red-500"}`}
                        style={{
                          width: `${selectedSession.confidence_score * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {renderExtractedData(selectedSession.extracted_data)}

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-3 mt-6 pt-4 border-t border-gray-100">
                  {/* View Transcript Button */}
                  {selectedSession.transcript && (
                    <button
                      onClick={() => setTranscriptModalOpen(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium"
                    >
                      <Play className="w-4 h-4" /> View Transcript
                    </button>
                  )}
                  {selectedSession.status === "draft" && (
                    <button
                      onClick={() => approveSession(selectedSession.id)}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium"
                    >
                      <CheckCircle className="w-4 h-4" /> {t("approveReview")}
                    </button>
                  )}
                  {selectedSession.status === "reviewed" && (
                    <button
                      onClick={() => commitSession(selectedSession.id)}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
                    >
                      <Upload className="w-4 h-4" /> {t("commitToEHR")}
                    </button>
                  )}
                  {["draft", "reviewed"].includes(selectedSession.status) && (
                    <button
                      onClick={() => discardSession(selectedSession.id)}
                      className="flex items-center gap-2 px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg text-sm font-medium"
                    >
                      <XCircle className="w-4 h-4" /> {t("discard")}
                    </button>
                  )}
                  {/* Delete Button - only for mutable sessions */}
                  {!["committed", "discarded"].includes(
                    selectedSession.status,
                  ) && (
                    <button
                      onClick={() => setDeleteConfirmId(selectedSession.id)}
                      className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium ml-auto"
                    >
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right: Session History */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900 mb-3">
                {t("recentSessions")}
              </h3>
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-16 bg-gray-100 rounded-lg animate-pulse"
                    />
                  ))}
                </div>
              ) : sessions.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">
                  {t("noSessions")}
                </p>
              ) : (
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        selectedSession?.id === s.id
                          ? "border-blue-300 bg-blue-50"
                          : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <button
                        onClick={() => setSelectedSession(s)}
                        className="w-full text-left"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[s.status]}`}
                          >
                            {STATUS_ICONS[s.status]}
                            {s.status}
                          </span>
                          <ChevronRight className="w-4 h-4 text-gray-300" />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {s.patient_mrn && (
                            <span className="font-medium">
                              {s.patient_mrn} ·{" "}
                            </span>
                          )}
                          {new Date(s.started_at).toLocaleString()}
                        </p>
                        {s.duration_seconds && (
                          <p className="text-xs text-gray-400">
                            {formatDuration(s.duration_seconds)}
                          </p>
                        )}
                      </button>
                      {/* Quick delete button */}
                      {!["committed", "discarded"].includes(s.status) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(s.id);
                          }}
                          className="mt-2 text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Transcript Modal */}
      {transcriptModalOpen && selectedSession?.transcript && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col m-4">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Session Transcript
                </h3>
                <p className="text-sm text-gray-500">
                  {selectedSession.patient_mrn &&
                    `${selectedSession.patient_mrn} · `}
                  {new Date(selectedSession.started_at).toLocaleString()}
                  {selectedSession.duration_seconds &&
                    ` · ${formatDuration(selectedSession.duration_seconds)}`}
                </p>
              </div>
              <button
                onClick={() => setTranscriptModalOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <div className="prose prose-sm max-w-none">
                <p className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                  {selectedSession.transcript}
                </p>
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setTranscriptModalOpen(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md m-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-red-100 rounded-full">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Delete Session?
                </h3>
                <p className="text-sm text-gray-500">
                  This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteSession(deleteConfirmId)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
