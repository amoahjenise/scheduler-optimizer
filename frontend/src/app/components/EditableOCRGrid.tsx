'use client'

import React from 'react'
import SectionCard from './SectionCard'

type GridRow = {
  id: string // unique id for stable keys
  nurse: string
  shifts: string[]
}

function generateEmptyRow(ocrDatesLength: number): GridRow {
  return {
    id: crypto.randomUUID(),
    nurse: '',
    shifts: Array(ocrDatesLength).fill(''),
  }
}

export default function EditableOCRGrid({
  ocrDates,
  ocrGrid,
  setOcrGrid,
  marker,
}: {
  ocrDates: string[]
  ocrGrid: GridRow[]
  setOcrGrid: React.Dispatch<React.SetStateAction<GridRow[]>>
  marker: string
}) {
  const [colWidths, setColWidths] = React.useState<number[]>(() => {
    const baseWidth = 120
    const shiftColWidth = 80
    return [baseWidth, ...ocrDates.map(() => shiftColWidth), 60]
  })

  React.useEffect(() => {
    // When dates change, adjust widths array length accordingly
    setColWidths((prev) => {
      const baseWidth = 120
      const shiftColWidth = 80
      const newWidths = [baseWidth, ...ocrDates.map(() => shiftColWidth), 60]
      // Keep existing widths for unchanged cols to avoid jump
      return newWidths.map((w, i) => prev[i] || w)
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

  function handleNurseChange(rowIndex: number, value: string) {
    setOcrGrid((prev) => {
      const updated = [...prev]
      updated[rowIndex] = {
        ...updated[rowIndex],
        nurse: value,
      }
      return updated
    })
  }

  function handleAddRow() {
    setOcrGrid((prev) => [...prev, generateEmptyRow(ocrDates.length)])
  }

  function handleRemoveRow(rowIndex: number) {
    setOcrGrid((prev) => prev.filter((_, i) => i !== rowIndex))
  }

  return (
    <SectionCard title="Editable Schedule Grid (OCR Review)" icon={<span>📝</span>}>
      <div className="overflow-x-auto">
        <table className="table-auto border-collapse w-full text-sm text-left text-gray-700"
               style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr>
            <th
              className="border border-blue-200 bg-blue-100 p-2 relative whitespace-normal break-words"
              style={{ width: colWidths[0], minWidth: 120, maxWidth: 300 }}
            >
                Nurse
                <div
                  onMouseDown={(e) => handleMouseDown(e, 0)}
                  className="absolute top-0 right-0 h-full w-1 cursor-col-resize select-none"
                  style={{ userSelect: 'none' }}
                />
              </th>
              {ocrDates.map((date, i) => (
                <th
                  key={date}
                  className="border border-blue-200 bg-blue-100 p-2 text-center relative"
                  style={{ width: colWidths[i + 1], minWidth: 40, maxWidth: 300 }}
                >
                  {date}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, i + 1)}
                    className="absolute top-0 right-0 h-full w-1 cursor-col-resize select-none"
                    style={{ userSelect: 'none' }}
                  />
                </th>
              ))}
              <th
                className="border border-blue-200 bg-blue-100 p-2 text-center"
                style={{ width: colWidths[colWidths.length - 1], minWidth: 40, maxWidth: 300 }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {ocrGrid.map((row, rowIndex) => (
              <tr key={row.id}>
                <td
                  className="border border-blue-200 bg-white p-2 font-medium"
                  style={{ width: colWidths[0], minWidth: 40, maxWidth: 300 }}
                >
                  <input
                    value={row.nurse}
                    onChange={(e) => handleNurseChange(rowIndex, e.target.value)}
                    placeholder="Nurse name"
                    className="w-full bg-transparent focus:outline-none resize-y overflow-auto break-words"
                    />
                </td>
                {row.shifts.map((shift, colIndex) => (
                  <td
                    key={colIndex}
                    className={`border border-blue-200 bg-white p-1 text-center ${
                      shift.includes(marker) ? 'bg-yellow-100' : ''
                    }`}
                    style={{ width: colWidths[colIndex + 1], minWidth: 40, maxWidth: 300 }}
                  >
                    <input
                      value={shift}
                      onChange={(e) => handleShiftChange(rowIndex, colIndex, e.target.value)}
                      className="w-full text-center bg-transparent focus:outline-none resize-y overflow-auto"
                    />
                  </td>
                ))}
                <td
                  className="border border-blue-200 bg-white p-2 text-center"
                  style={{ width: colWidths[colWidths.length - 1], minWidth: 40, maxWidth: 300 }}
                >
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(rowIndex)}
                    aria-label={`Remove nurse row ${row.nurse || rowIndex + 1}`}
                    className="text-red-600 hover:text-red-800 font-bold"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3">
        <button
          type="button"
          onClick={handleAddRow}
          className="px-4 py-2 bg-sky-600 text-white rounded hover:bg-sky-700 transition"
        >
          + Add Nurse
        </button>
      </div>
    </SectionCard>
  )
}
