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
        placeholder="Max 3 night shifts per week, avoid back-to-back shifts..."
        rows={4}
        className="w-full rounded-md border border-blue-200 bg-white p-3 text-sm"
      />
    </SectionCard>
  )
}
