'use client'

import React from 'react'
import SectionCard from './SectionCard'
import { CalendarHeart } from 'lucide-react'

type SchedulePreviewProps = {
  ocrGrid: { nurse: string; shifts: string[] }[]
  ocrDates: string[]
}

function formatDateISO(dateString: string) {
  const [year, month, day] = dateString.split('-').map(Number)
  if (!year || !month || !day) return dateString
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`
}

export default function SchedulePreview({ ocrGrid, ocrDates }: SchedulePreviewProps) {
  const [colWidths, setColWidths] = React.useState<number[]>(() => {
    const baseWidth = 160
    const shiftWidth = 80
    return [baseWidth, ...ocrDates.map(() => shiftWidth)]
  })

  React.useEffect(() => {
    setColWidths((prev) => {
      const baseWidth = 160
      const shiftWidth = 80
      const updated = [baseWidth, ...ocrDates.map(() => shiftWidth)]
      return updated.map((w, i) => prev[i] || w)
    })
  }, [ocrDates])

  const resizingColIndex = React.useRef<number | null>(null)
  const startX = React.useRef(0)
  const startWidth = React.useRef(0)

  function handleMouseDown(e: React.MouseEvent, colIndex: number) {
    resizingColIndex.current = colIndex
    startX.current = e.clientX
    startWidth.current = colWidths[colIndex]
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    e.preventDefault()
  }

  function handleMouseMove(e: MouseEvent) {
    if (resizingColIndex.current === null) return
    const deltaX = e.clientX - startX.current
    const newWidth = Math.max(40, startWidth.current + deltaX)
    setColWidths((prev) => {
      const updated = [...prev]
      updated[resizingColIndex.current!] = newWidth
      return updated
    })
  }

  function handleMouseUp() {
    resizingColIndex.current = null
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  }

  return (
    <SectionCard title="Schedule Preview Calendar" icon={<CalendarHeart className="text-sky-600" />}>
      <div className="overflow-x-auto">
        <table className="table-auto border-collapse text-sm text-left text-gray-700 w-full">
          <thead className="bg-blue-100">
            <tr>
              <th
                className="border border-blue-200 p-2 relative font-semibold"
                style={{ width: colWidths[0], minWidth: 60 }}
              >
                Nurse
                <div
                  onMouseDown={(e) => handleMouseDown(e, 0)}
                  className="absolute top-0 right-0 h-full w-1 cursor-col-resize select-none"
                />
              </th>
              {ocrDates.map((date, i) => (
                <th
                  key={date}
                  className={`border border-blue-200 p-2 text-center relative font-semibold ${
                    i === ocrDates.length - 1 ? 'border-r border-blue-200' : ''
                  }`}
                  style={{ width: colWidths[i + 1], minWidth: 40 }}
                >
                  {formatDateISO(date)}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, i + 1)}
                    className="absolute top-0 right-0 h-full w-1 cursor-col-resize select-none"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ocrGrid.map(({ nurse, shifts }, rowIndex) => (
              <tr key={rowIndex} className="even:bg-gray-50 border-b border-blue-200">
                <td
                  className="border border-blue-200 p-2 font-medium"
                  style={{ width: colWidths[0], minWidth: 60 }}
                >
                  {nurse}
                </td>
                {shifts.map((shift, i) => (
                  <td
                    key={i}
                    className={`border border-blue-200 p-2 text-center ${
                      i === shifts.length - 1 ? 'border-r border-blue-200' : ''
                    }`}
                    style={{ width: colWidths[i + 1], minWidth: 40 }}
                  >
                    {shift || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}
