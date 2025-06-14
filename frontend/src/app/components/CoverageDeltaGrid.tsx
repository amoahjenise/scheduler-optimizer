import React from 'react'
import SectionCard from './SectionCard'

type OCRRow = {
  nurse: string
  shifts: string[]
}

export default function CoverageDeltaGrid({
  ocrGrid,
  ocrDates,
  requiredStaff,
  shiftHours
}: {
  ocrGrid: OCRRow[]
  ocrDates: string[]
  requiredStaff: Record<string, Record<string, number>>
  shiftHours: Record<string, number>
}) {
  const shiftTypes = Array.from(
    new Set(ocrGrid.flatMap(row => row.shifts).filter(Boolean))
  )

  const actualStaff: Record<string, Record<string, number>> = {}

  // Count actual assignments per (shift, date)
  for (let i = 0; i < ocrGrid.length; i++) {
    const row = ocrGrid[i]
    for (let j = 0; j < row.shifts.length; j++) {
      const shift = row.shifts[j]
      const date = ocrDates[j]
      if (!shift || !date) continue
      actualStaff[shift] ??= {}
      actualStaff[shift][date] ??= 0
      actualStaff[shift][date]++
    }
  }

  // Compute daily delta
  const dailyHourDelta: Record<string, number> = {}
  for (const shift of shiftTypes) {
    for (const date of ocrDates) {
      const actual = actualStaff[shift]?.[date] ?? 0
      const required = requiredStaff[shift]?.[date] ?? 0
      const delta = actual - required
      const hours = shiftHours[shift] ?? 0
      dailyHourDelta[date] ??= 0
      dailyHourDelta[date] += delta * hours
    }
  }

  return (
    <SectionCard title="Coverage Deltas">
      <div className="overflow-auto">
        <table className="min-w-full text-sm border border-red-300">
          <thead>
            <tr className="bg-red-100">
              <th className="p-2 border">Shift</th>
              {ocrDates.map(date => (
                <th key={date} className="p-2 border">{date}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shiftTypes.map(shift => (
              <tr key={shift}>
                <td className="border px-2 py-1 font-semibold">{shift}</td>
                {ocrDates.map(date => {
                  const actual = actualStaff[shift]?.[date] ?? 0
                  const required = requiredStaff[shift]?.[date] ?? 0
                  const delta = actual - required
                  return (
                    <td
                      key={date}
                      className={`border px-2 py-1 text-center ${delta > 0 ? 'bg-green-100' : delta < 0 ? 'bg-red-100' : ''}`}
                    >
                      {delta === 0 ? '✓' : delta > 0 ? `+${delta}` : delta}
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr className="bg-gray-100 font-semibold">
              <td className="border px-2 py-1">Daily Hours Δ</td>
              {ocrDates.map(date => (
                <td key={date} className="border px-2 py-1 text-center">
                  {dailyHourDelta[date] > 0 ? `+${dailyHourDelta[date]}` : dailyHourDelta[date]}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}
