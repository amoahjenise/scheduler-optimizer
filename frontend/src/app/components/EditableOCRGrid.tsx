// components/EditableOCRGrid.tsx
'use client'

import React from 'react'
import SectionCard from './SectionCard'

type GridRow = {
  nurse: string
  shifts: string[]
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

  return (
    <SectionCard title="Editable Schedule Grid (OCR Review)" icon={<span>📝</span>}>
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
                    className={`border border-blue-200 bg-white p-1 text-center ${
                      shift.includes(marker) ? 'bg-yellow-100' : ''
                    }`}
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
  )
}
