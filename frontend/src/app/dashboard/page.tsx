// app/dashboard/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { Upload, CalendarHeart, Stethoscope, Eye } from 'lucide-react'
import UploadInput from '../components/UploadInput'
import EditableOCRGrid from '../components/EditableOCRGrid'
import AutoCommentsBox from '../components/AutoCommentsBox'
import RulesTextarea from '../components/RulesEditor'
import NotesEditor from '../components/NotesEditor'
import SchedulePreview from '../components/SchedulePreview'
import SectionCard from '../components/SectionCard'
import { validateComments } from './utils'

export default function Dashboard() {
  const [screenshots, setScreenshots] = useState<File[]>([])
  const [notes, setNotes] = useState('')
  const [rules, setRules] = useState('')
  const [autoComments, setAutoComments] = useState('')
  const [marker, setMarker] = useState('✱')
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  // Mock OCR Data
  const [ocrDates, setOcrDates] = useState([
    '2025-06-01',
    '2025-06-02',
    '2025-06-03',
    '2025-06-04',
    '2025-06-05',
  ])

  const [ocrGrid, setOcrGrid] = useState([
    { nurse: 'Jane Doe', shifts: ['Day ✱', '', 'Night', '', ''] },
    { nurse: 'Mark Lee', shifts: ['', 'Night', '', 'Day', 'Off'] },
    { nurse: 'Ella Smith', shifts: ['', '', 'Day', '', 'Night'] },
  ])

  // Update autoComments based on ocrGrid and marker
  useEffect(() => {
    const lines: string[] = []

    ocrGrid.forEach((row) => {
      row.shifts.forEach((shift, idx) => {
        if (shift.includes(marker)) {
          lines.push(`${row.nurse}|${ocrDates[idx]}|`)
        }
      })
    })

    setAutoComments(lines.join('\n'))
  }, [ocrGrid, ocrDates, marker])

  // Validate autoComments on change
  useEffect(() => {
    setValidationErrors(validateComments(autoComments))
  }, [autoComments])

  function handleOptimize() {
    alert('Optimization triggered! (mock implementation)')
  }

  function handleExport() {
    // Export autoComments as JSON
    const comments = autoComments
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [nurse, date, comment = ''] = line.split('|')
        return { nurse, date, comment }
      })

    const blob = new Blob([JSON.stringify(comments, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'autoComments.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-sky-50 to-blue-100 text-gray-900 px-6 py-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-10">
        <h1
          className="text-5xl font-extrabold text-blue-900 tracking-tight"
          style={{ fontFamily: 'var(--font-geist-sans)' }}
        >
          Chronofy Dashboard
        </h1>

        <UploadInput screenshots={screenshots} setScreenshots={setScreenshots} />

        <SectionCard
          title="Employee Comment Marker"
          icon={<Eye className="text-sky-600" />}
        >
          <input
            type="text"
            maxLength={2}
            value={marker}
            onChange={(e) => setMarker(e.target.value || '✱')}
            className="border border-blue-300 rounded-md px-3 py-1 w-16 text-center"
            aria-label="Custom marker for comments"
          />
        </SectionCard>

        <EditableOCRGrid
          ocrDates={ocrDates}
          ocrGrid={ocrGrid}
          setOcrGrid={setOcrGrid}
          marker={marker}
        />

        <AutoCommentsBox
          autoComments={autoComments}
          setAutoComments={setAutoComments}
          validationErrors={validationErrors}
        />

        <RulesTextarea rules={rules} setRules={setRules} />
        <NotesEditor notes={notes} setNotes={setNotes} />
        <SchedulePreview />

        <div className="flex flex-wrap gap-4 mt-4">
          <button
            onClick={handleOptimize}
            className="px-6 py-3 bg-sky-600 hover:bg-sky-700 text-white rounded-md font-medium transition"
          >
            Optimize Schedule
          </button>
          <button
            onClick={handleExport}
            className="px-6 py-3 border border-sky-600 text-sky-700 hover:bg-sky-100 rounded-md font-medium transition"
          >
            Export Comments JSON
          </button>
        </div>
      </div>
    </main>
  )
}
