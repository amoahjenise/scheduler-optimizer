import React from 'react'
import SectionCard from './SectionCard'

export default function NotesEditor({
  notes,
  setNotes,
}: {
  notes: string
  setNotes: React.Dispatch<React.SetStateAction<string>>
}) {
  return (
    <SectionCard title="Add Notes or Comments">
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Include optional context or preferences..."
        rows={4}
        className="w-full rounded-md border border-blue-200 bg-white p-3 text-sm"
      />
    </SectionCard>
  )
}
