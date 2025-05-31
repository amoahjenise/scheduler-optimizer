import React from 'react'
import SectionCard from './SectionCard'
import { Stethoscope } from 'lucide-react'

export default function RulesEditor({
  rules,
  setRules,
}: {
  rules: string
  setRules: React.Dispatch<React.SetStateAction<string>>
}) {
  return (
    <SectionCard title="Define Shift Rules" icon={<Stethoscope className="text-sky-600" />}>
      <textarea
        value={rules}
        onChange={(e) => setRules(e.target.value)}
        placeholder={`Write rules as key=value pairs, one per line.
Example:
max_consecutive_days=3
day_required_nurses=5
night_required_nurses=4
chemo_certtified_required_per_shift=2
full_time_hours=75`}
        rows={6}
        className="w-full rounded-md border border-blue-200 bg-white p-3 text-sm font-mono whitespace-pre-wrap"
      />
    </SectionCard>
  )
}
