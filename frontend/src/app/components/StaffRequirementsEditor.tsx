import React from 'react'
import SectionCard from './SectionCard'

export default function StaffRequirementsEditor({
  ocrDates,
  shiftTypes,
  requiredStaff,
  setRequiredStaff,
  shiftHours,
  setShiftHours
}: {
  ocrDates: string[]
  shiftTypes: string[]
  requiredStaff: Record<string, Record<string, number>>
  setRequiredStaff: React.Dispatch<React.SetStateAction<Record<string, Record<string, number>>>>
  shiftHours: Record<string, number>
  setShiftHours: React.Dispatch<React.SetStateAction<Record<string, number>>>
}) {
  function handleStaffChange(shift: string, date: string, value: number) {
    setRequiredStaff(prev => ({
      ...prev,
      [shift]: {
        ...prev[shift],
        [date]: value
      }
    }))
  }

  function handleHoursChange(shift: string, value: number) {
    setShiftHours(prev => ({
      ...prev,
      [shift]: value
    }))
  }

  return (
    <SectionCard title="Staff Requirements & Shift Hours">
      <div className="overflow-auto">
        <table className="min-w-full text-sm border border-blue-300">
          <thead>
            <tr className="bg-blue-100">
              <th className="p-2 border">Shift</th>
              {ocrDates.map(date => (
                <th key={date} className="p-2 border">{date}</th>
              ))}
              <th className="p-2 border">Hours / Shift</th>
            </tr>
          </thead>
          <tbody>
            {shiftTypes.map(shift => (
              <tr key={shift}>
                <td className="border px-2 py-1 font-semibold">{shift}</td>
                {ocrDates.map(date => (
                  <td key={date} className="border px-2 py-1">
                    <input
                      type="number"
                      value={requiredStaff[shift]?.[date] ?? ''}
                      onChange={e => handleStaffChange(shift, date, Number(e.target.value))}
                      className="w-14 border rounded px-1 text-center"
                      min={0}
                    />
                  </td>
                ))}
                <td className="border px-2 py-1">
                  <input
                    type="number"
                    value={shiftHours[shift] ?? ''}
                    onChange={e => handleHoursChange(shift, Number(e.target.value))}
                    className="w-14 border rounded px-1 text-center"
                    min={0}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}
