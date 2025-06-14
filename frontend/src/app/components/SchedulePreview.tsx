'use client'

import React, { useState, useMemo, useEffect } from 'react'
import SectionCard from './SectionCard'
import { CalendarHeart, Undo2, Trash2, RefreshCcw } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  useDraggable,
  DragOverEvent,
  DragStartEvent,
  useDroppable,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { UUID } from 'crypto'

interface SchedulePreviewProps {
  ocrGrid: { nurse: string; shifts: ShiftEntry[] }[]
  ocrDates: string[]
}

interface ShiftEntry {
  // id: UUID
  date: string
  shift: string
  shiftType: 'day' | 'night'
  hours: number
  startTime: string
  endTime: string
}

const shiftColor = (shiftType: string) => {
  switch (shiftType) {
    case 'day':
      return 'bg-yellow-100 text-yellow-800'
    case 'night':
      return 'bg-slate-200 text-slate-900'
    default:
      return 'bg-blue-100 text-blue-900'
  }
}

function getShiftTimes(shift: string, shiftType: 'day' | 'night'): { startTime: string; endTime: string } {
  const mapping: Record<string, { startTime: string; endTime: string }> = {
    '07': { startTime: '07:00', endTime: '15:00' },
    'Z07': { startTime: '07:00', endTime: '19:00' },
    'Z19': { startTime: '19:00', endTime: '07:00' },
    'Z23': { startTime: '23:00', endTime: '07:00' },
    'Z23 B': { startTime: '19:00', endTime: '07:00' },
  }
  return mapping[shift] || { 
    startTime: shiftType === 'day' ? '07:00' : '19:00', 
    endTime: shiftType === 'day' ? '19:00' : '07:00' 
  }
}

function makeId(nurse: string, shiftEntry: ShiftEntry) {
  return `${nurse}|${shiftEntry.date}|${shiftEntry.shift}`
}

function parseId(id: string) {
  const [nurse, date, shift] = id.split('|')
  return { nurse, date, shift }
}

function DraggableShift({
  id,
  nurse,
  shiftEntry,
  onDelete,
}: {
  id: string
  nurse: string
  shiftEntry: ShiftEntry
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`text-xs px-2 py-1 rounded-md font-medium shadow-sm cursor-move flex items-center justify-between gap-2 ${
        shiftColor(shiftEntry.shiftType)
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      <span className="whitespace-normal" title={`${nurse}: ${shiftEntry.shift}`}>
        {nurse}: {shiftEntry.shift} ({shiftEntry.startTime} - {shiftEntry.endTime}) [{shiftEntry.hours} hrs]
      </span>
      <button 
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }} 
        title="Delete" 
        type="button"
        className="focus:outline-none"
      >
        <Trash2 className="w-3.5 h-3.5 text-red-400 hover:text-red-600" />
      </button>
    </div>
  )
}

function DroppableDay({
  date,
  shifts,
  displayDate,
  handleDelete,
}: {
  date: string
  shifts: { nurse: string; shiftEntry: ShiftEntry }[]
  displayDate: string
  handleDelete: (date: string, id: string) => void
}) {
  const { setNodeRef } = useDroppable({ id: date })

  return (
    <div
      ref={setNodeRef}
      id={date}
      className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm flex flex-col"
    >
      <div className="text-xs font-semibold text-gray-600 mb-2 text-right">{displayDate}</div>
      <div className="flex flex-col gap-1 min-h-[4rem]">
        {shifts.length === 0 ? (
          <div className="text-xs text-gray-300 text-center py-4">No shifts</div>
        ) : (
          <SortableContext 
            items={shifts.map(({ nurse, shiftEntry }) => makeId(nurse, shiftEntry))}
            strategy={verticalListSortingStrategy}
          >
            {shifts.map(({ nurse, shiftEntry }) => {
              const id = makeId(nurse, shiftEntry)
              return (
                <DraggableShift
                  key={id}
                  id={id}
                  nurse={nurse}
                  shiftEntry={shiftEntry}
                  onDelete={() => handleDelete(date, id)}
                />
              )
            })}
          </SortableContext>
        )}
      </div>
    </div>
  )
}

export default function SchedulePreview({ ocrGrid, ocrDates }: SchedulePreviewProps) {
  const originalShiftMap = useMemo(() => {
    const map = new Map<string, { nurse: string; shiftEntry: ShiftEntry }[]>()
    ocrGrid.forEach(({ nurse, shifts }) => {
      shifts.forEach((shiftEntry) => {
        if (!map.has(shiftEntry.date)) map.set(shiftEntry.date, [])
        map.get(shiftEntry.date)!.push({ nurse, shiftEntry })
      })
    })
    return map
  }, [ocrGrid])

  const [shiftMap, setShiftMap] = useState(new Map(originalShiftMap))
  const [history, setHistory] = useState<Map<string, { nurse: string; shiftEntry: ShiftEntry }[]>[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    setShiftMap(new Map(originalShiftMap))
    setHistory([])
  }, [originalShiftMap])

  const saveHistory = () => {
    setHistory((prev) => [new Map(shiftMap), ...prev.slice(0, 19)])
  }

  const handleUndo = () => {
    if (history.length === 0) return
    setShiftMap(new Map(history[0]))
    setHistory((prev) => prev.slice(1))
  }

  const handleReset = () => {
    setShiftMap(new Map(originalShiftMap))
    setHistory([])
  }

  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: {
      distance: 5,
    },
  }))

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id.toString())
  }

  const handleDragOver = (event: DragOverEvent) => {}

  const handleDragEndWithMove = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) {
      setActiveId(null)
      return
    }

    const activeId = active.id.toString()
    const overId = over.id.toString()

    if (!activeId.includes('|')) return

    const { nurse, date: fromDate, shift } = parseId(activeId)
    const toDate = overId

    const dragged = shiftMap.get(fromDate)?.find(
      (e) => e.nurse === nurse && e.shiftEntry.shift === shift && e.shiftEntry.date === fromDate
    )
    if (!dragged || fromDate === toDate) return

    saveHistory()

    setShiftMap(prev => {
      const newMap = new Map(prev)
      const fromList = [...(newMap.get(fromDate) || [])]
      const toList = [...(newMap.get(toDate) || [])]

      newMap.set(
        fromDate,
        fromList.filter(
          (e) => !(e.nurse === nurse && e.shiftEntry.shift === shift && e.shiftEntry.date === fromDate)
        )
      )

      const updatedEntry = { nurse, shiftEntry: { ...dragged.shiftEntry, date: toDate } }
      newMap.set(toDate, [...toList, updatedEntry])

      return newMap
    })

    setActiveId(null)
  }

  const handleDelete = (date: string, id: string) => {
    const { nurse, shift } = parseId(id)
    saveHistory()
    setShiftMap(prev => {
      const newMap = new Map(prev)
      const shifts = [...(newMap.get(date) || [])]
      newMap.set(
        date,
        shifts.filter(
          (e) =>
            !(e.nurse === nurse && e.shiftEntry.shift === shift && e.shiftEntry.date === date)
        )
      )
      return newMap
    })
  }

  const sortedShiftMap = useMemo(() => {
    const newMap = new Map<string, { nurse: string; shiftEntry: ShiftEntry }[]>()
    shiftMap.forEach((entries, date) => {
      const dayShifts = entries.filter(e => e.shiftEntry.shiftType === 'day')
      const nightShifts = entries.filter(e => e.shiftEntry.shiftType === 'night')
      newMap.set(date, [...dayShifts, ...nightShifts])
    })
    return newMap
  }, [shiftMap])

  const shiftMapWithTimes = useMemo(() => {
    const newMap = new Map<string, { nurse: string; shiftEntry: ShiftEntry }[]>()
    sortedShiftMap.forEach((entries, date) => {
      const updatedEntries = entries.map(({ nurse, shiftEntry }) => {
        const { startTime, endTime } = getShiftTimes(shiftEntry.shift, shiftEntry.shiftType)
        return {
          nurse,
          shiftEntry: { ...shiftEntry, startTime, endTime },
        }
      })
      newMap.set(date, updatedEntries)
    })
    return newMap
  }, [sortedShiftMap])

  const rows: string[][] = []
  for (let i = 0; i < ocrDates.length; i += 7) {
    rows.push(ocrDates.slice(i, i + 7))
  }

  return (
    <SectionCard
      title="Schedule Calendar"
      icon={<CalendarHeart className="text-pink-600" />}
      actions={
        <div className="flex gap-2">
          <button onClick={handleUndo} title="Undo" className="hover:text-blue-500" type="button">
            <Undo2 />
          </button>
          <button onClick={handleReset} title="Reset" className="hover:text-rose-500" type="button">
            <RefreshCcw />
          </button>
        </div>
      }
    >
      <DndContext 
        sensors={sensors} 
        collisionDetection={closestCenter} 
        onDragStart={handleDragStart}
        onDragEnd={handleDragEndWithMove}
        onDragOver={handleDragOver}
      >
        <div className="space-y-4">
          {rows.map((week, weekIdx) => (
            <div
              key={weekIdx}
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4"
            >
              {week.map((date) => {
                const parsedDate = parseISO(date)
                const displayDate = format(parsedDate, 'EEE, MMM d')
                const shifts = (shiftMapWithTimes.get(date) || []).filter(({ shiftEntry }) => shiftEntry.hours > 0)

                return (
                  <DroppableDay
                    key={date}
                    date={date}
                    shifts={shifts}
                    displayDate={displayDate}
                    handleDelete={handleDelete}
                  />
                )
              })}
              {week.length < 7 &&
                Array.from({ length: 7 - week.length }).map((_, i) => (
                  <div key={`empty-${i}`} className="invisible" />
                ))}
            </div>
          ))}
        </div>
      </DndContext>
    </SectionCard>
  )
}
