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
import { parseImageWithFastAPI } from '@/app/lib/ocrFastAPI'

export default function Dashboard() {
  const today = new Date().toISOString().split('T')[0]
  const twoWeeksLater = new Date(Date.now() + 13 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(twoWeeksLater)
  const [screenshots, setScreenshots] = useState<File[]>([])
  const [notes, setNotes] = useState('')
  const [rules, setRules] = useState('')
  const [autoComments, setAutoComments] = useState('')
  const [marker, setMarker] = useState('✱')
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  const [ocrDates, setOcrDates] = useState<string[]>([])
  const [ocrGrid, setOcrGrid] = useState<{ nurse: string; shifts: string[] }[]>([])
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrError, setOcrError] = useState<string | null>(null)

  useEffect(() => {
    if (
      screenshots.length === 0 ||
      !startDate ||
      !endDate ||
      new Date(startDate) > new Date(endDate)
    ) return

    async function runOCR() {
      setOcrLoading(true)
      setOcrError(null)

      try {
        const allDates = new Set<string>()
        const combinedGrid: { [nurse: string]: { [date: string]: string } } = {}

        for (const file of screenshots) {
          const result: {
            dates: string[]
            grid: { nurse: string; shifts: string[] }[]
          } = await parseImageWithFastAPI(file, startDate, endDate)

          result.dates.forEach((date: string) => allDates.add(date))

          result.grid.forEach((entry: { nurse: string; shifts: string[] }) => {
            const { nurse, shifts } = entry
            if (!combinedGrid[nurse]) combinedGrid[nurse] = {}

            result.dates.forEach((date: string, i: number) => {
              const shift = shifts[i]
              if (shift) {
                combinedGrid[nurse][date] = shift
              }
            })
          })
        }

        const sortedDates = Array.from(allDates).sort()
        const finalGrid = Object.entries(combinedGrid).map(
          ([nurse, shiftMap]: [string, { [date: string]: string }]) => ({
            nurse,
            shifts: sortedDates.map(date => shiftMap[date] || ''),
          })
        )

        setOcrDates(sortedDates)
        setOcrGrid(finalGrid)
      } catch (err: any) {
        console.error('OCR error', err)
        setOcrError(err.message || 'Failed to extract schedule')
      } finally {
        setOcrLoading(false)
      }
    }

    runOCR()
  }, [screenshots, startDate, endDate])

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

  useEffect(() => {
    setValidationErrors(validateComments(autoComments))
  }, [autoComments])

  function handleOptimize() {
    alert('Optimization triggered! (mock implementation)')
  }

  function handleExport() {
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
        <h1 className="text-5xl font-extrabold text-blue-900 tracking-tight" style={{ fontFamily: 'var(--font-geist-sans)' }}>
          Chronofy Dashboard
        </h1>

        <UploadInput screenshots={screenshots} setScreenshots={setScreenshots} />

        <SectionCard title="Period Dates" icon={<CalendarHeart className="text-sky-600" />}>
          <div className="flex flex-col gap-2">
            <div className="flex gap-4 flex-wrap">
              <label className="flex flex-col text-sm">
                Start Date
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="border border-blue-300 rounded-md px-3 py-1"
                />
              </label>
              <label className="flex flex-col text-sm">
                End Date
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="border border-blue-300 rounded-md px-3 py-1"
                />
              </label>
            </div>
            <div className="text-sm text-gray-700">
              Period Selected: <strong>{startDate}</strong> → <strong>{endDate}</strong>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Employee Comment Marker" icon={<Eye className="text-sky-600" />}>
          <input
            type="text"
            maxLength={2}
            value={marker}
            onChange={(e) => setMarker(e.target.value || '✱')}
            className="border border-blue-300 rounded-md px-3 py-1 w-16 text-center"
            aria-label="Custom marker for comments"
          />
        </SectionCard>

        {ocrLoading && <p className="text-blue-600">Processing screenshots with OCR...</p>}
        {ocrError && <p className="text-red-600">OCR Error: {ocrError}</p>}

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
