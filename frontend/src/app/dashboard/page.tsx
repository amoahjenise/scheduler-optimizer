'use client'

import { useState, useEffect } from 'react'
import { CalendarHeart, Stethoscope, Eye } from 'lucide-react'
import UploadInput from '../components/UploadInput'
import EditableOCRGrid from '../components/EditableOCRGrid'
import AutoCommentsBox from '../components/AutoCommentsBox'
import RulesTextarea from '../components/RulesEditor'
import NotesEditor from '../components/NotesEditor'
import SchedulePreview from '../components/SchedulePreview'
import SectionCard from '../components/SectionCard'
import { validateComments } from './utils'
import { parseImageWithFastAPI, createScheduleAPI, optimizeScheduleAPI } from '@/app/lib/api'
import {
  useUser
} from '@clerk/nextjs'

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
  type GridRow = { id: string; nurse: string; shifts: string[] }
  const [ocrGrid, setOcrGrid] = useState<GridRow[]>([])
  const [optimizedGrid, setOptimizedGrid] = useState<{ nurse: string; shifts: string[] }[] | null>(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrError, setOcrError] = useState<string | null>(null)

  const [myScheduleId, setMyScheduleId] = useState<string | null>(null)

  const [optimizing, setOptimizing] = useState(false)

  const { user } = useUser();
  const userId = user?.id || '';

  async function createSchedule() {
    if (screenshots.length === 0) {
      alert('Please upload at least one schedule image.')
      return
    }

    try {
      const data = await createScheduleAPI(screenshots, startDate, endDate, notes, rules, autoComments, userId)
      setMyScheduleId(data.id)
      alert('Schedule created successfully! Ready to optimize.')
    } catch (error: any) {
      alert('Failed to create schedule: ' + error.message)
    }
  }

  useEffect(() => {
    if (screenshots.length === 0 || !startDate || !endDate || new Date(startDate) > new Date(endDate)) return
  
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
            shifts: sortedDates.map((date) => shiftMap[date] || ''),
          })
        )
  
        setOcrDates(sortedDates)
  
        // Add unique IDs to each row here:
        const gridWithIds: GridRow[] = finalGrid.map((row) => ({
          id: crypto.randomUUID(),
          nurse: row.nurse,
          shifts: row.shifts,
        }))
  
        setOcrGrid(gridWithIds)
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

  async function handleOptimize() {
    setOptimizing(true)
    try {
      function parseRulesText(rulesText: string): Record<string, number> {
        const rulesObj: Record<string, number> = {}
        rulesText.split('\n').forEach((line) => {
          const [key, value] = line.split('=').map((s) => s.trim())
          if (key && value !== undefined) {
            const number = Number(value)
            if (!isNaN(number)) {
              rulesObj[key] = number
            }
          }
        })
        return rulesObj
      }
  
      const parsedRules = parseRulesText(rules)
  
      const assignments: Record<string, string[]> = {}
      ocrGrid.forEach(({ nurse, shifts }) => {
        assignments[nurse] = shifts
      })
  
      const comments: Record<string, Record<string, string>> = {}
      autoComments.split('\n').forEach((line) => {
        if (!line.trim()) return
        const [nurse, date, comment] = line.split('|')
        if (!comments[nurse]) comments[nurse] = {}
        comments[nurse][date] = comment || ''
      })
  
      const reqBody = {
        schedule_id: myScheduleId,
        nurses: ocrGrid.map((row) => row.nurse),
        dates: ocrDates,
        assignments,
        comments,
        rules: parsedRules,
        notes
      }
  
      const data = await optimizeScheduleAPI(reqBody)
  
      const optimizedAssignments = data.optimized_schedule as Record<string, string[]>
  
      const optimized = Object.entries(optimizedAssignments).map(([nurse, shifts]) => ({
        nurse,
        shifts,
      }))
  
      setOptimizedGrid(optimized)
      alert('Schedule optimized successfully!')
    } catch (error: any) {
      alert('Unexpected error during optimization: ' + error.message)
    } finally {
      setOptimizing(false)
    }
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
        <h1
          className="text-5xl font-extrabold text-blue-900 tracking-tight"
          style={{ fontFamily: 'var(--font-geist-sans)' }}
        >
          Chronofy Dashboard
        </h1>
  
        {/* Combined horizontal row for Period Dates, Marker */}
        <div className="flex flex-wrap items-stretch gap-4">     
          {/* Period Dates */}
          <SectionCard
            title="Period Dates"
            icon={<CalendarHeart className="text-sky-600" />}
            className="flex-1 min-w-[250px]"
          >
            <div className="flex gap-4 flex-wrap items-center">
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
          </SectionCard>

          {/* Marker */}
          <SectionCard
            title="Comment Marker"
            icon={<Eye className="text-sky-600" />}
            className="flex-1 min-w-[250px]"
          >
            <input
              type="text"
              maxLength={2}
              value={marker}
              onChange={(e) => setMarker(e.target.value || '✱')}
              className="border border-blue-300 rounded-md px-3 py-3 w-full text-center"
              aria-label="Custom marker for comments"
            />
          </SectionCard>
        </div>

        <UploadInput screenshots={screenshots} setScreenshots={setScreenshots} />

        {ocrLoading && <p className="text-blue-600">Processing screenshots with OCR...</p>}
        {ocrError && <p className="text-red-600">OCR Error: {ocrError}</p>}

        <EditableOCRGrid ocrDates={ocrDates} ocrGrid={ocrGrid} setOcrGrid={setOcrGrid} marker={marker} />

        <AutoCommentsBox autoComments={autoComments} setAutoComments={setAutoComments} validationErrors={validationErrors} />

        <RulesTextarea rules={rules} setRules={setRules} />
        <NotesEditor notes={notes} setNotes={setNotes} />
        <SchedulePreview ocrGrid={optimizedGrid ?? ocrGrid} ocrDates={ocrDates} />

        <div className="flex flex-wrap gap-4 mt-4">
          <button
            onClick={createSchedule}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-md font-medium transition"
          >
            Create Schedule
          </button>
          <button
            onClick={handleOptimize}
            disabled={!myScheduleId || optimizing}
            className={`px-6 py-3 rounded-md font-medium transition ${
              myScheduleId && !optimizing
                ? 'bg-sky-600 hover:bg-sky-700 text-white cursor-pointer'
                : 'bg-gray-300 text-gray-600 cursor-not-allowed'
            }`}
          >
            {optimizing ? 'Optimizing...' : 'Optimize Schedule'}
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
