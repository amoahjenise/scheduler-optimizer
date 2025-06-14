import React from 'react'
import SectionCard from './SectionCard'
import { User2 } from 'lucide-react'

export default function AutoCommentsBox({
  autoComments,
  setAutoComments,
  validationErrors,
}: {
  autoComments: string
  setAutoComments: React.Dispatch<React.SetStateAction<string>>
  validationErrors: string[]
}) {
  return (
    <SectionCard title="Detected Marker Comments (Employee Notes)" icon={<User2 className="text-sky-600" size={24} aria-hidden="true" />}>
      <textarea
        value={autoComments}
        onChange={(e) => setAutoComments(e.target.value)}
        placeholder="Jane Doe|2025-06-02|..."
        rows={6}
        className="w-full rounded-md border border-blue-200 bg-white p-3 text-sm font-mono"
      />
      {validationErrors.length > 0 && (
        <ul className="mt-2 text-red-600 text-sm list-disc pl-5">
          {validationErrors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
