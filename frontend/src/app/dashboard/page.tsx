'use client'

import { useState, useEffect, useRef } from 'react'
import { CalendarHeart, Eye, UploadCloud, CheckCircle2, Download, AlertTriangle } from 'lucide-react'
import UploadInput from '../components/UploadInput'
import EditableOCRGrid from '../components/EditableOCRGrid'
import AutoCommentsBox from '../components/AutoCommentsBox'
import NotesEditor from '../components/NotesEditor'
import SchedulePreview from '../components/SchedulePreview'
import SectionCard from '../components/SectionCard'
import SystemPrompt from '../components/SystemPrompt'
import { validateComments } from './utils'
import { parseImageWithFastAPI, createScheduleAPI, optimizeScheduleAPI } from '@/app/lib/api'
import { useUser } from '@clerk/nextjs'
import { ChevronDown, ChevronRight, CheckCircle, Wand2, FileDown } from 'lucide-react'
import Confetti from 'react-confetti'
import { useWindowSize } from 'react-use'
import { motion } from 'framer-motion'
import CharacterAssistant from '../components/CharacterAssistant'
import CoverageDeltaGrid from '../components/CoverageDeltaGrid'
import StaffRequirementsEditor from '../components/StaffRequirementsEditor'

interface ShiftAssignment {
  date: string
  shift: string
  shiftType: 'day' | 'night'
  hours: number
  startTime: string
  endTime: string
}

interface ShiftEntry extends ShiftAssignment {}

interface OptimizedScheduleResponse {
  optimized_schedule: Record<string, ShiftAssignment[]>
  id: string
}

export default function Dashboard() {
  const today = new Date().toISOString().split('T')[0]
  const twoWeeksLater = new Date(Date.now() + 13 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(twoWeeksLater)
  const [screenshots, setScreenshots] = useState<File[]>([])
  const [notes, setNotes] = useState('')
  const [rules, setRules] = useState('')
  const [autoComments, setAutoComments] = useState('')
  const [marker, setMarker] = useState('*')
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  const [ocrDates, setOcrDates] = useState<string[]>([])
  type GridRow = { id: string; nurse: string; shifts: ShiftEntry[] }
  const [ocrGrid, setOcrGrid] = useState<GridRow[]>([])
  const [optimizedSchedule, setOptimizedSchedule] = useState<Record<string, ShiftAssignment[]> | null>(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrError, setOcrError] = useState<string | null>(null)

  const [myScheduleId, setMyScheduleId] = useState<string | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)
  const { width, height } = useWindowSize()
  const previewRef = useRef<HTMLDivElement>(null)
  const { user } = useUser()
  const userId = user?.id || ''

  const [requiredStaff, setRequiredStaff] = useState<Record<string, Record<string, number>>>({});
  const [shiftHours, setShiftHours] = useState<Record<string, number>>({});
  const shiftTypes = ['Morning', 'Afternoon', 'Evening']

  async function createSchedule() {
    if (screenshots.length === 0) {
      alert('Please upload at least one schedule image.')
      return
    }

    try {
      const data = await createScheduleAPI(screenshots, startDate, endDate, notes, rules, autoComments, userId)
      setMyScheduleId(data.id)
      setShowConfetti(true)
      setTimeout(() => setShowConfetti(false), 5000)
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
        const combinedGrid: { [nurse: string]: { [date: string]: ShiftEntry } } = {}
  
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
                combinedGrid[nurse][date] = {
                  date,
                  shift,
                  shiftType: 'day',
                  hours: 0,
                  startTime: '',
                  endTime: ''
                }
              }
            })
          })
        }
  
        const sortedDates = Array.from(allDates).sort()
        const finalGrid = Object.entries(combinedGrid).map(
          ([nurse, shiftMap]: [string, { [date: string]: ShiftEntry }]) => ({
            nurse,
            shifts: sortedDates.map((date) => shiftMap[date] || {
              date,
              shift: '',
              shiftType: 'day',
              hours: 0,
              startTime: '',
              endTime: ''
            }),
          })
        )
  
        setOcrDates(sortedDates)
  
        const gridWithIds: GridRow[] = finalGrid.map((row) => ({
          id: crypto.randomUUID(),
          nurse: row.nurse,
          shifts: row.shifts,
        }))
  
        setOcrGrid(gridWithIds)
        setShowConfetti(true)
        setTimeout(() => setShowConfetti(false), 5000)

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
      row.shifts.forEach((shift) => {
        if (shift.shift.includes(marker)) {
          lines.push(`${row.nurse}|${shift.date}|`)
        }
      })
    })

    setAutoComments(lines.join('\n'))
  }, [ocrGrid, marker])

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
        assignments[nurse] = shifts.map(shift => shift.shift)
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
        notes,
        start_date: startDate,
        end_date: endDate
      }      
  
      const data: OptimizedScheduleResponse = await optimizeScheduleAPI(reqBody)
      setOptimizedSchedule(data.optimized_schedule)
      setShowConfetti(true)
      setTimeout(() => setShowConfetti(false), 5000)
      
      setTimeout(() => {
        previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 200)

    } catch (error: any) {
      alert('Unexpected error during optimization: ' + error.message)
    } finally {
      setOptimizing(false)
    }
  }  
  
  function convertOptimizedToGrid(
    optimizedSchedule: Record<string, ShiftAssignment[]> | null,
    ocrDates: string[]
  ): { nurse: string; shifts: ShiftEntry[] }[] {
    if (!optimizedSchedule) return [];
  
    return Object.entries(optimizedSchedule).map(([nurse, assignments]) => {
      const shifts: ShiftEntry[] = ocrDates.map(date => {
        const assignment = assignments.find(a => a.date === date);
        return assignment
          ? { ...assignment }
          : {
              date,
              shift: '',
              shiftType: 'day',
              hours: 0,
              startTime: '',
              endTime: '',
            };
      });
      return { nurse, shifts };
    });
  }
  
  
  return (
    <>
      {showConfetti && (
        <motion.div
          className="fixed inset-0 pointer-events-none z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <Confetti width={width} height={height} />
        </motion.div>
      )}
  
      <main className="min-h-screen bg-gradient-to-br from-sky-50 to-blue-100 text-gray-900 px-6 py-10">
        <div className="max-w-6xl mx-auto flex flex-col gap-7">
          <h1 className="text-5xl font-extrabold text-blue-900 tracking-tight">
            Dashboard 
          </h1>
          <p className="mt-1 text-lg text-slate-600">
            Configure, preview, and optimize your schedule with confidence.
          </p>
  
          <section className="border border-gray-300 rounded-md bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center justify-between w-full px-4 py-3 font-semibold text-sky-700 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-400 rounded-t-md"
              aria-expanded={showAdvanced}
              aria-controls="advanced-settings-panel"
            >
              <span>Advanced Settings</span>
              {showAdvanced ? (
                <ChevronDown className="w-5 h-5 text-sky-700" aria-hidden="true" />
              ) : (
                <ChevronRight className="w-5 h-5 text-sky-700" aria-hidden="true" />
              )}
            </button>
  
            {showAdvanced && (
              <div id="advanced-settings-panel" className="p-4 border-t border-gray-200">
                <SystemPrompt />
              </div>
            )}
          </section>
  
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <SectionCard
              title="Period Dates"
              icon={<CalendarHeart className="text-sky-600" size={24} aria-hidden="true" />}
              className="min-w-0"
            >
              <form
                className="flex flex-wrap gap-4 items-center"
                onSubmit={(e) => e.preventDefault()}
                aria-describedby="period-dates-desc"
              >
                <div className="flex flex-col">
                  <label htmlFor="startDate" className="text-sm font-semibold text-sky-700 mb-1">
                    Start Date
                  </label>
                  <input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="border border-blue-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
                    aria-required="true"
                    min={today}
                    max={endDate}
                  />
                </div>
                <div className="flex flex-col">
                  <label htmlFor="endDate" className="text-sm font-semibold text-sky-700 mb-1">
                    End Date
                  </label>
                  <input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="border border-blue-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
                    aria-required="true"
                    min={startDate > today ? startDate : today}
                  />
                </div>
              </form>
              <p id="period-dates-desc" className="mt-1 text-xs text-gray-500 max-w-xs">
                Select the schedule period. The end date must be on or after the start date.
              </p>
            </SectionCard>
  
            <SectionCard
              title="Comment Marker"
              icon={<Eye className="text-sky-600" size={24} aria-hidden="true" />}
              className="min-w-0"
            >
              <label htmlFor="markerInput" className="sr-only">
                Custom marker for comments
              </label>
              <input
                id="markerInput"
                type="text"
                maxLength={2}
                value={marker}
                onChange={(e) => setMarker(e.target.value || '✱')}
                className="border border-blue-300 rounded-md px-3 py-3 w-full text-center text-lg font-semibold placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
                aria-describedby="markerHelp"
                placeholder="✱"
              />
              <p id="markerHelp" className="mt-1 text-xs text-gray-500">
                Set a symbol to mark comments in the schedule grid (max 2 characters).
              </p>
            </SectionCard>
  
            <UploadInput screenshots={screenshots} setScreenshots={setScreenshots} />
            {ocrLoading && (
              <div className="mt-3 text-blue-600 flex items-center gap-2 font-medium" role="status">
                <UploadCloud className="animate-spin w-5 h-5" />
                Processing screenshots... This may take a moment.
              </div>
            )}
            {ocrError && (
              <div className="mt-3 text-red-600 flex items-center gap-2 font-semibold" role="alert">
                <AlertTriangle className="w-5 h-5" />
                OCR failed: {ocrError}. Please try again or upload different images.
              </div>
            )}
          </section>
  
          <EditableOCRGrid ocrDates={ocrDates} ocrGrid={ocrGrid} setOcrGrid={setOcrGrid} marker={marker} />
          <AutoCommentsBox autoComments={autoComments} setAutoComments={setAutoComments} validationErrors={validationErrors} />
          <NotesEditor notes={notes} setNotes={setNotes} />
          
          <div ref={previewRef}>
          <SchedulePreview 
            ocrGrid={
              optimizedSchedule
                ? convertOptimizedToGrid(optimizedSchedule, ocrDates) ?? []
                : ocrGrid
            }
            ocrDates={ocrDates}
          />
          </div>
          {/* <StaffRequirementsEditor
            requiredStaff={requiredStaff}
            setRequiredStaff={setRequiredStaff}
            shiftHours={shiftHours}
            setShiftHours={setShiftHours}
            ocrDates={ocrDates}
            shiftTypes={shiftTypes}
                      
          /> */}
          {/* <CoverageDeltaGrid
            ocrGrid={optimizedSchedule ?? ocrGrid} // always falls back to ocrGrid
            ocrDates={ocrDates}
            requiredStaff={requiredStaff}
            shiftHours={shiftHours}
          /> */}
          <div className="flex flex-wrap gap-4 mt-6">
            <button
              onClick={createSchedule}
              className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-md font-semibold shadow-sm transition"
            >
              <CheckCircle className="w-5 h-5" />
              Create Schedule
            </button>
            <button
              onClick={handleOptimize}
              disabled={!myScheduleId || optimizing}
              className={`flex items-center gap-2 px-6 py-3 rounded-md font-semibold transition shadow-sm ${
                myScheduleId && !optimizing
                  ? 'bg-sky-600 hover:bg-sky-700 text-white'
                  : 'bg-gray-300 text-gray-600 cursor-not-allowed'
              }`}
            >
              <Wand2 className="w-5 h-5" />
              {optimizing ? 'Optimizing...' : 'Optimize Schedule'}
            </button>
          </div>
          
          <CharacterAssistant 
            status={
              optimizing ? 'loading' :
              ocrError ? 'error' :
              (showConfetti ? 'success' : 'idle')
            } 
          />
        </div>
      </main>
    </>
  )
}