'use client'

import { useState, useEffect } from 'react'
import { Upload, CalendarHeart, Stethoscope, Eye, Download } from 'lucide-react'

export default function Dashboard() {
  const [screenshots, setScreenshots] = useState<File[]>([])
  const [notes, setNotes] = useState('')
  const [rules, setRules] = useState('')
  const [autoComments, setAutoComments] = useState('')
  const [marker, setMarker] = useState('✱')
  const [commentWarning, setCommentWarning] = useState(false)

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
    { nurse: 'Ella Smith', shifts: ['', '', 'Day', '', 'Night ✱'] },
  ])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return
    setScreenshots([...screenshots, ...Array.from(e.target.files)])
  }

  function handleShiftChange(rowIndex: number, colIndex: number, value: string) {
    setOcrGrid((prev) => {
      const updated = [...prev]
      updated[rowIndex] = {
        ...updated[rowIndex],
        shifts: [...updated[rowIndex].shifts],
      }
      updated[rowIndex].shifts[colIndex] = value
      return updated
    })
  }

  function handleOptimize() {
    alert('Optimization triggered! (mock implementation)')
  }

  function handleExport() {
    const json = JSON.stringify(autoComments.split('\n').map(line => {
      const [nurse, date, note] = line.split('|')
      return { nurse, date, note }
    }), null, 2)

    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'autoComments.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ✱ detection + comment generation
  useEffect(() => {
    const lines: string[] = []
    ocrGrid.forEach((row) => {
      row.shifts.forEach((shift, colIndex) => {
        if (shift.includes(marker)) {
          const nurse = row.nurse
          const date = ocrDates[colIndex]
          lines.push(`${nurse}|${date}|`)
        }
      })
    })
    setAutoComments(lines.join('\n'))
  }, [ocrGrid, ocrDates, marker])

  useEffect(() => {
    const malformed = autoComments
      .split('\n')
      .some(line => line && line.split('|').length < 3)
    setCommentWarning(malformed)
  }, [autoComments])

  return (
    <main className="min-h-screen bg-gradient-to-br from-sky-50 to-blue-100 text-gray-900 px-6 py-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-10">
        <h1
          className="text-5xl font-extrabold text-blue-900 tracking-tight"
          style={{ fontFamily: 'var(--font-geist-sans)' }}
        >
          Chronofy Dashboard
        </h1>

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

        <SectionCard title="Editable Schedule Grid (OCR Review)" icon={<Eye className="text-sky-600" />}>
          <div className="overflow-x-auto">
            <table className="table-auto border-collapse w-full text-sm text-left text-gray-700">
              <thead>
                <tr>
                  <th className="border border-blue-200 bg-blue-100 p-2">Nurse</th>
                  {ocrDates.map((date) => (
                    <th key={date} className="border border-blue-200 bg-blue-100 p-2 text-center">
                      {date}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ocrGrid.map((row, rowIndex) => (
                  <tr key={row.nurse}>
                    <td className="border border-blue-200 bg-white p-2 font-medium">{row.nurse}</td>
                    {row.shifts.map((shift, colIndex) => (
                      <td
                        key={colIndex}
                        className={`border border-blue-200 bg-white p-1 text-center ${shift.includes(marker) ? 'bg-yellow-100' : ''}`}
                      >
                        <input
                          value={shift}
                          onChange={(e) => handleShiftChange(rowIndex, colIndex, e.target.value)}
                          className="w-full text-center bg-transparent focus:outline-none"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title="Detected {marker} Comments (Employee Notes)">
          <textarea
            value={autoComments}
            onChange={(e) => setAutoComments(e.target.value)}
            placeholder="Jane Doe|2025-06-02|..."
            rows={6}
            className="w-full rounded-md border border-blue-200 bg-white p-3 text-sm font-mono"
          />
          {commentWarning && <p className="text-red-500 text-sm">⚠️ Some lines may be malformed. Make sure each has: Nurse|Date|Note</p>}
        </SectionCard>

        <SectionCard title="Customize Marker">
          <input
            value={marker}
            onChange={(e) => setMarker(e.target.value)}
            className="w-20 text-center border border-blue-300 rounded-md p-1"
          />
        </SectionCard>

        <SectionCard title="Define Shift Rules" icon={<Stethoscope className="text-sky-600" />}>
          <textarea
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            placeholder="Max 3 night shifts per week, avoid back-to-back shifts..."
            rows={4}
            className="w-full rounded-md border border-blue-200 bg-white p-3 text-sm"
          />
        </SectionCard>

        <SectionCard title="Add Notes or Comments">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Include optional context or preferences..."
            rows={4}
            className="w-full rounded-md border border-blue-200 bg-white p-3 text-sm"
          />
        </SectionCard>

        <SectionCard title="Schedule Preview Calendar" icon={<CalendarHeart className="text-sky-600" />}>
          <div className="grid grid-cols-7 text-center text-sm text-gray-600 border border-blue-200 rounded-md overflow-hidden">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <div key={day} className="bg-blue-100 p-2 font-medium">
                {day}
              </div>
            ))}
            {['Jane (Day)', '—', 'Mark (Night)', 'Ella (Day)', 'John (Off)', '—', 'Sami (Night)'].map((shift, i) => (
              <div key={i} className="p-3 bg-white border-t border-blue-100">
                {shift}
              </div>
            ))}
          </div>
        </SectionCard>

        <div className="flex flex-wrap gap-4 mt-4">
          <button
            onClick={handleOptimize}
            className="px-6 py-3 bg-sky-600 hover:bg-sky-700 text-white rounded-md font-medium transition"
          >
            Optimize Schedule
          </button>
          <button
            onClick={handleExport}
            className="px-6 py-3 border border-sky-600 text-sky-700 hover:bg-sky-100 rounded-md font-medium transition flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> Export Comments
          </button>
        </div>
      </div>
    </main>
  )
}

function SectionCard({
  title,
  children,
  icon,
}: {
  title: string
  children: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-blue-200 p-6 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {icon && <div className="text-2xl">{icon}</div>}
        <h2 className="text-xl font-semibold text-blue-800">{title}</h2>
      </div>
      {children}
    </section>
  )
}