import React, { useRef } from 'react'
import { Upload } from 'lucide-react'
import SectionCard from './SectionCard'

export default function UploadInput({
  screenshots,
  setScreenshots,
}: {
  screenshots: File[]
  setScreenshots: React.Dispatch<React.SetStateAction<File[]>>
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return
    setScreenshots((prev) => [...prev, ...Array.from(e.target.files!)])
  }

  function handleRemoveFile(index: number) {
    setScreenshots((prev) => prev.filter((_, i) => i !== index))
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setScreenshots((prev) => [...prev, ...Array.from(e.dataTransfer.files)])
      e.dataTransfer.clearData()
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
  }

  return (
    <SectionCard title="Upload Schedule Screenshots" icon={<Upload className="text-sky-600" />}>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="border-2 border-dashed border-sky-400 rounded-md p-6 text-center cursor-pointer hover:border-sky-600 transition"
        onClick={() => fileInputRef.current?.click()}
        aria-label="Drag and drop schedule screenshots here or click to upload"
      >
        <Upload className="mx-auto mb-3 text-sky-600" size={48} />
        <p className="text-sm text-sky-700">
          Drag & drop images here, or <button type="button" className="underline font-semibold">browse</button> to select files
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {screenshots.length > 0 && (
        <ul className="mt-4 space-y-2 max-h-40 overflow-auto">
          {screenshots.map((file, i) => (
            <li
              key={i}
              className="flex items-center justify-between bg-sky-100 rounded-md px-3 py-1 text-sm text-sky-900"
            >
              <span className="truncate" title={file.name}>
                {file.name} <span className="text-xs text-gray-600">({(file.size / 1024).toFixed(1)} KB)</span>
              </span>
              <button
                type="button"
                onClick={() => handleRemoveFile(i)}
                aria-label={`Remove ${file.name}`}
                className="text-red-500 hover:text-red-700 transition"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
