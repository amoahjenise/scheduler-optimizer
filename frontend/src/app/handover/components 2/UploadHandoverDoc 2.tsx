"use client";

import { useState, useCallback } from "react";
import { Patient, PatientCreate, createBulkPatientsAPI } from "../../lib/api";

interface UploadHandoverDocProps {
  onPatientsImported: (patients: Patient[]) => void;
  onClose: () => void;
}

interface ParsedPatient {
  room: string;
  bed?: string;
  name: string;
  mrn?: string;
  diagnosis?: string;
  attending?: string;
  ivAccess?: string;
  isolation?: string;
  allergies?: string;
}

export default function UploadHandoverDoc({
  onPatientsImported,
  onClose,
}: UploadHandoverDocProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedPatients, setParsedPatients] = useState<ParsedPatient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"upload" | "review" | "importing">("upload");

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (!selectedFile) return;

      setFile(selectedFile);
      setError(null);
      setLoading(true);

      try {
        // For Word docs, we'll extract text using a simple approach
        // In production, you'd use mammoth.js or send to backend
        const text = await extractTextFromFile(selectedFile);
        const patients = parseHandoverText(text);

        if (patients.length === 0) {
          setError(
            "No patients found in the document. Please check the format.",
          );
        } else {
          setParsedPatients(patients);
          setStep("review");
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to parse document",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const extractTextFromFile = async (file: File): Promise<string> => {
    // For .txt files, read directly
    if (file.name.endsWith(".txt")) {
      return await file.text();
    }

    // For Word docs (.docx), we need to parse the XML
    // Using a simple approach - in production use mammoth.js
    if (file.name.endsWith(".docx")) {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file);
      const xmlContent = await zip.file("word/document.xml")?.async("text");

      if (!xmlContent) {
        throw new Error("Could not read Word document content");
      }

      // Extract text from XML (simple approach)
      const textContent = xmlContent
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      return textContent;
    }

    throw new Error("Unsupported file format. Please upload .docx or .txt");
  };

  const parseHandoverText = (text: string): ParsedPatient[] => {
    const patients: ParsedPatient[] = [];

    // Common patterns in handover sheets
    // Pattern 1: "Room 401A - Smith, John - ALL - Dr. Jones"
    // Pattern 2: "401 | Smith John | Diagnosis | ..."
    // Pattern 3: Table rows with room numbers

    // Split by common delimiters
    const lines = text.split(/[\n\r]+/).filter((line) => line.trim());

    // Try to detect room numbers (3-4 digit patterns)
    const roomPattern = /\b(\d{3,4})[A-Z]?\b/;

    let currentRoom = "";

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Skip headers and empty lines
      if (
        trimmedLine.length < 5 ||
        /^(room|patient|name|diagnosis|status)/i.test(trimmedLine)
      ) {
        continue;
      }

      // Check for room number
      const roomMatch = trimmedLine.match(roomPattern);
      if (roomMatch) {
        currentRoom = roomMatch[1];

        // Try to extract patient info from same line
        // Format: "401A Smith, John ALL Dr. Jones PIV"
        const parts = trimmedLine.split(/[|,\t]+/).map((p) => p.trim());

        if (parts.length >= 2) {
          const patient: ParsedPatient = {
            room: currentRoom,
            name: "",
          };

          // Extract bed letter if present
          const bedMatch = trimmedLine.match(/\d{3,4}([A-Z])/);
          if (bedMatch) {
            patient.bed = bedMatch[1];
          }

          // Try to find name (usually after room, before diagnosis keywords)
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];

            // Skip if it's just the room number
            if (/^\d{3,4}[A-Z]?$/.test(part)) continue;

            // Check if it looks like a name (contains letters, possibly comma)
            if (
              /^[A-Za-z]+[,\s]+[A-Za-z]+$/.test(part) ||
              /^[A-Za-z]+ [A-Za-z]+$/.test(part)
            ) {
              patient.name = part;
              continue;
            }

            // Check for diagnosis keywords
            if (
              /ALL|AML|NHL|Neuroblastoma|Lymphoma|Leukemia/i.test(part) &&
              !patient.diagnosis
            ) {
              patient.diagnosis = part;
              continue;
            }

            // Check for doctor names
            if (/Dr\.?|MD/i.test(part) && !patient.attending) {
              patient.attending = part;
            }

            // Check for IV access
            if (/PIV|Central|Port|PICC|Broviac/i.test(part)) {
              patient.ivAccess = part;
            }

            // Check for isolation
            if (/Contact|Droplet|Airborne|Neutropenic/i.test(part)) {
              patient.isolation = part.toLowerCase();
            }
          }

          if (patient.name || parts.length > 1) {
            // If no name found, use first non-room part
            if (!patient.name && parts[1]) {
              patient.name = parts[1];
            }
            patients.push(patient);
          }
        }
      }
    }

    return patients;
  };

  const handleImport = async () => {
    setStep("importing");
    setError(null);

    try {
      // Convert parsed patients to API format
      const patientsToCreate: PatientCreate[] = parsedPatients.map((p) => {
        // Parse name (handle "Last, First" or "First Last")
        let firstName = "";
        let lastName = "";
        if (p.name.includes(",")) {
          const parts = p.name.split(",").map((s) => s.trim());
          lastName = parts[0];
          firstName = parts[1] || "";
        } else {
          const parts = p.name.split(" ");
          firstName = parts[0] || "";
          lastName = parts.slice(1).join(" ") || parts[0] || "";
        }

        return {
          mrn:
            p.mrn ||
            `AUTO-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          first_name: firstName,
          last_name: lastName,
          room_number: p.room,
          bed: p.bed,
          diagnosis: p.diagnosis,
          attending_physician: p.attending,
        };
      });

      const imported = await createBulkPatientsAPI(patientsToCreate);
      onPatientsImported(imported);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to import patients",
      );
      setStep("review");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {step === "upload" && "Upload Handover Document"}
            {step === "review" && "Review Imported Patients"}
            {step === "importing" && "Importing..."}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {step === "upload" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Upload your Word document (.docx) or text file (.txt) containing
                the patient handover sheet. The system will parse room numbers,
                patient names, diagnoses, and other information.
              </p>

              <label className="block">
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-blue-400 hover:bg-blue-50/50 transition-colors cursor-pointer">
                  <input
                    type="file"
                    accept=".docx,.txt"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  {loading ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                      <span className="text-gray-600">Parsing document...</span>
                    </div>
                  ) : (
                    <>
                      <svg
                        className="w-12 h-12 text-gray-400 mx-auto mb-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                        />
                      </svg>
                      <span className="text-gray-600 font-medium">
                        Click to upload or drag and drop
                      </span>
                      <span className="text-sm text-gray-400 mt-1 block">
                        .docx or .txt files
                      </span>
                    </>
                  )}
                </div>
              </label>

              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium text-gray-700 mb-2">
                  Supported Formats
                </h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>
                    • Room-based lists: &quot;401A Smith, John ALL Dr.
                    Jones&quot;
                  </li>
                  <li>
                    • Table format: &quot;Room | Patient | Diagnosis | ...&quot;
                  </li>
                  <li>• Any format with room numbers (3-4 digits)</li>
                </ul>
              </div>
            </div>
          )}

          {step === "review" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Found {parsedPatients.length} patients. Review and edit before
                importing:
              </p>

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-700">
                        Room
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-gray-700">
                        Name
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-gray-700">
                        Diagnosis
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-gray-700">
                        Attending
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedPatients.map((patient, idx) => (
                      <tr key={idx} className="border-t border-gray-100">
                        <td className="px-3 py-2">
                          {patient.room}
                          {patient.bed}
                        </td>
                        <td className="px-3 py-2">{patient.name}</td>
                        <td className="px-3 py-2 text-gray-600">
                          {patient.diagnosis || "—"}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {patient.attending || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === "importing" && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4" />
              <span className="text-gray-600">
                Importing {parsedPatients.length} patients...
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 text-sm font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
          {step === "review" && (
            <button
              onClick={handleImport}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Import {parsedPatients.length} Patients
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
