"use client";

import { useState, useRef, useEffect } from "react";

// Nursing phrase suggestions organized by field type/category
const PHRASE_SUGGESTIONS: Record<string, string[]> = {
  // Status/Condition
  status: [
    "Stable and resting comfortably",
    "Stable on current treatment plan",
    "Stable with no acute concerns",
    "Improving since admission",
    "Improving on current medications",
    "Improved pain control noted",
    "Unchanged from previous shift",
    "Worsening - MD aware",
    "Critical - close monitoring required",
  ],

  // Current condition
  current_condition: [
    "Alert and oriented x4",
    "Resting quietly in bed",
    "Ambulating independently",
    "Sleeping, easily arousable",
    "Appears comfortable",
    "Mild distress noted",
    "In moderate distress",
    "Family at bedside",
    "Awaiting test results",
  ],

  // Pertinent issues
  pertinent_issues: [
    "Febrile neutropenia",
    "Mucositis - grade II",
    "Nausea/vomiting - controlled with antiemetics",
    "Pain management - PCA in use",
    "Fall risk - bed alarm on",
    "NPO for procedure",
    "Isolation precautions in place",
    "New diagnosis - family coping",
    "Discharge planning in progress",
  ],

  // IV access
  iv_access: [
    "PIV x1 right forearm, patent",
    "PIV x1 left hand, flushing well",
    "PIV x2 bilateral, patent",
    "PICC line right arm, dressing intact",
    "Central line - triple lumen, all ports patent",
    "Port-a-cath accessed, no issues",
    "No IV access currently",
  ],

  cvad_type: [
    "PICC single lumen",
    "PICC double lumen",
    "Hickman single lumen",
    "Hickman double lumen",
    "Port-a-cath",
    "Triple lumen central line",
    "Broviac catheter",
  ],

  // Labs
  abnormal_labs: [
    "WBC low - neutropenic precautions",
    "Hgb low - transfusion ordered",
    "Platelets low - bleeding precautions",
    "ANC recovering",
    "Potassium low - replacement ordered",
    "Creatinine elevated - monitoring",
    "All labs within normal limits",
  ],

  // Vitals
  abnormal_vitals: [
    "Afebrile, VSS",
    "Low grade fever - cultures pending",
    "Febrile - blood cultures drawn",
    "Tachycardic - monitoring",
    "Hypotensive - fluids given",
    "Hypertensive - MD notified",
    "O2 sats low on RA - O2 applied",
  ],

  // Pain
  pain_notes: [
    "Pain well controlled",
    "Pain at goal per patient",
    "Breakthrough pain - PRN given",
    "Non-verbal pain scale used",
    "PCA effective, no adjustments needed",
    "Positioning helps with comfort",
    "Distraction techniques effective",
  ],

  // Respiratory
  lung_assessment: [
    "Clear to auscultation bilaterally",
    "Diminished bases bilaterally",
    "Crackles noted bilateral bases",
    "Wheezing - albuterol given",
    "Rhonchi - encouraged deep breathing",
    "Labored breathing - O2 increased",
  ],

  oxygen_needs: [
    "Room air, sats >95%",
    "2L NC, sats 94-96%",
    "4L NC, maintaining sats >92%",
    "High flow NC",
    "CPAP at night",
    "BiPAP settings: ",
    "Ventilator dependent",
  ],

  // GI
  diet: [
    "Regular diet, eating well",
    "Regular diet, poor appetite",
    "Soft/mechanical diet",
    "Clear liquids only",
    "NPO",
    "NPO except meds",
    "Tube feeds via NG/GT",
    "TPN running",
  ],

  vomiting: [
    "No nausea/vomiting",
    "Mild nausea, no vomiting",
    "Nausea controlled with Zofran",
    "Vomited x1, tolerated antiemetic",
    "Frequent vomiting - NPO",
    "Retching without emesis",
  ],

  // Activity
  activity: [
    "Up ad lib",
    "Up with assistance x1",
    "Up with assistance x2",
    "Bedrest",
    "Bedrest with BRP",
    "OOB to chair TID",
    "PT/OT consult placed",
    "Fall precautions in place",
  ],

  // Neuro
  neuro_notes: [
    "A&O x4, follows commands",
    "A&O x3, baseline per family",
    "Lethargic but arousable",
    "Oriented to person only",
    "PERRL, grips equal",
    "MAE, no focal deficits",
  ],

  // Discharge
  discharge_teaching: [
    "Teaching started - patient receptive",
    "Teaching ongoing - family involved",
    "Teaching completed - return demo done",
    "Written instructions provided",
    "Needs reinforcement on medications",
    "Home health referral placed",
  ],

  // Safety
  safety_concerns: [
    "Bed alarm on, bed in low position",
    "Side rails x2 up",
    "Call light within reach",
    "Non-skid socks on",
    "Family providing supervision",
    "1:1 sitter in place",
    "Seizure precautions",
  ],

  // Plan
  plan: [
    "Continue current plan",
    "Continue monitoring q4h",
    "Continue antibiotics per ID",
    "Await culture results",
    "Pending consult from specialist",
    "Discharge planning meeting scheduled",
    "Goals of care discussion needed",
    "Comfort measures discussed",
  ],

  // Generic fallback
  default: [
    "See nursing notes",
    "No changes this shift",
    "Continue per orders",
    "MD aware",
    "Family updated",
    "Patient stable",
  ],
};

interface SmartTextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  fieldType?: string;
  className?: string;
  multiline?: boolean;
  rows?: number;
}

export default function SmartTextInput({
  value,
  onChange,
  placeholder,
  fieldType = "default",
  className = "",
  multiline = false,
  rows = 2,
}: SmartTextInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Get suggestions for this field type
  const suggestions =
    PHRASE_SUGGESTIONS[fieldType] || PHRASE_SUGGESTIONS.default;

  // Filter suggestions based on input
  useEffect(() => {
    if (!value || value.length < 2) {
      setFilteredSuggestions(suggestions.slice(0, 5));
      return;
    }

    const searchTerms = value.toLowerCase().split(" ");
    const filtered = suggestions.filter((phrase) => {
      const phraseLower = phrase.toLowerCase();
      return searchTerms.some((term) => phraseLower.includes(term));
    });

    // Also include suggestions that start with the first word
    const startsWithFiltered = suggestions.filter((phrase) =>
      phrase.toLowerCase().startsWith(value.toLowerCase()),
    );

    // Combine and dedupe
    const combined = [...new Set([...startsWithFiltered, ...filtered])];
    setFilteredSuggestions(combined.slice(0, 6));
    setSelectedIndex(0);
  }, [value, suggestions]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || filteredSuggestions.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredSuggestions.length - 1 ? prev + 1 : 0,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredSuggestions.length - 1,
        );
        break;
      case "Tab":
      case "Enter":
        if (filteredSuggestions[selectedIndex]) {
          e.preventDefault();
          onChange(filteredSuggestions[selectedIndex]);
          setShowSuggestions(false);
        }
        break;
      case "Escape":
        setShowSuggestions(false);
        break;
    }
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(e.target as Node) &&
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const InputComponent = multiline ? "textarea" : "input";

  return (
    <div className="relative">
      <InputComponent
        ref={inputRef as React.Ref<HTMLInputElement & HTMLTextAreaElement>}
        type={multiline ? undefined : "text"}
        rows={multiline ? rows : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setShowSuggestions(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={`w-full ${className}`}
      />

      {/* Suggestions dropdown */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"
        >
          <div className="px-2 py-1 text-[10px] text-gray-400 bg-gray-50 border-b">
            💡 Suggestions (Tab to select)
          </div>
          {filteredSuggestions.map((suggestion, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                onChange(suggestion);
                setShowSuggestions(false);
                inputRef.current?.focus();
              }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                idx === selectedIndex
                  ? "bg-blue-50 text-blue-700"
                  : "hover:bg-gray-50 text-gray-700"
              }`}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
