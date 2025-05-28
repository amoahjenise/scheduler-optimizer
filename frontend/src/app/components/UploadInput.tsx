import React from 'react'
import { Upload } from 'lucide-react'
import SectionCard from './SectionCard'

export default function UploadInput({
  screenshots,
  setScreenshots,
}: {
  screenshots: File[]
  setScreenshots: React.Dispatch<React.SetStateAction<File[]>>
}) {
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return
    setScreenshots((prev) => [...prev, ...Array.from(e.target.files!)])
}

  return (
    <SectionCard title="Upload Schedule Screenshots" icon={<Upload className="text-sky-600" />}>
      <input
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileChange}
        className="block mt-2"
      />
      {screenshots.length > 0 && (
        <ul className="list-disc pl-5 mt-2 text-sm text-gray-700">
          {screenshots.map((file, i) => (
            <li key={i}>{file.name}</li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
