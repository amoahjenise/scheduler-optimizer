import React from "react";
import SectionCard from "./SectionCard";
import { Stethoscope, Info } from "lucide-react";

export default function RulesEditor({
  rules,
  setRules,
}: {
  rules: string;
  setRules: React.Dispatch<React.SetStateAction<string>>;
}) {
  return (
    <SectionCard
      title="Additional Rules (Optional)"
      icon={<Stethoscope className="text-sky-600" />}
    >
      <div className="mb-2 flex items-start gap-2 rounded-md bg-blue-50 p-2 text-xs text-blue-700">
        <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <span>
          Default rules (shift codes, 3-day max, staffing requirements) are
          already configured in the system prompt. Use this section only for{" "}
          <strong>additional</strong> or <strong>schedule-specific</strong>{" "}
          rules.
        </span>
      </div>
      <textarea
        value={rules}
        onChange={(e) => setRules(e.target.value)}
        placeholder={`Add custom rules for THIS schedule (leave empty to use defaults):

Examples:
• Nurse A must work Monday and Tuesday
• No night shifts for Nurse B this week
• Need 6 day nurses on 2025-03-15 (special event)
• Nurse C and Nurse D should not work same shift
• Prefer 12h shifts over 8h shifts this period`}
        rows={5}
        className="w-full rounded-md border border-blue-200 bg-white p-3 text-sm whitespace-pre-wrap"
      />
    </SectionCard>
  );
}
