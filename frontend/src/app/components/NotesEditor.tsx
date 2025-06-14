import React from 'react'
import SectionCard from './SectionCard'
import { Notebook } from 'lucide-react'

export default function NotesEditor({
  notes,
  setNotes,
}: {
  notes: string
  setNotes: React.Dispatch<React.SetStateAction<string>>
}) {
  return (
    <SectionCard title="Add Notes or Comments" icon={<Notebook className="text-sky-600" size={24} aria-hidden="true" />}>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="E.g., 'Nurse name' is a chemo-certified nurse. Include any special context or preferences..."
        rows={4}
        className="w-full rounded-md border border-blue-200 bg-white p-3 text-sm"
      />
    </SectionCard>
  )
}
