import React from 'react'
import SectionCard from './SectionCard'
import { CalendarHeart } from 'lucide-react'

export default function SchedulePreview() {
  return (
    <SectionCard title="Schedule Preview Calendar" icon={<CalendarHeart className="text-sky-600" />}>
      <div className="grid grid-cols-7 text-center text-sm text-gray-600 border border-blue-200 rounded-md overflow-hidden">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <div key={day} className="bg-blue-100 p-2 font-medium">
            {day}
          </div>
        ))}
        {['Jane (Day)', '—', 'Mark (Night)', 'Ella (Day)', 'John (Off)', '—', 'Sami (Night)'].map(
          (shift, i) => (
            <div key={i} className="p-3 bg-white border-t border-blue-100">
              {shift}
            </div>
          ),
        )}
      </div>
    </SectionCard>
  )
}
