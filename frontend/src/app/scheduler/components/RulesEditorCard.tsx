"use client";

import React from "react";

interface RulesEditorProps {
  rules: string;
  onChange: (rules: string) => void;
}

export default function RulesEditor({ rules, onChange }: RulesEditorProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        3. Scheduling Rules (Optional)
      </h2>
      <p className="text-sm text-gray-500 mb-3">
        Add unit-specific or period-specific rules not covered by the system
        defaults.
      </p>
      <textarea
        value={rules}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Examples of custom rules you can add:&#10;&#10;• Nurse X is on vacation Mar 10-15&#10;• Nurse Y can only work day shifts this period&#10;• Need extra coverage on weekends (6 nurses minimum)&#10;• Nurse Z is precepting - pair with senior nurse&#10;• Float pool available: Nurse A, Nurse B&#10;• No overtime for part-time staff this period"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-40 resize-none"
      />
    </div>
  );
}
