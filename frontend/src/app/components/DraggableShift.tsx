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
} from '@dnd-kit/core'

interface SchedulePreviewProps {
  ocrGrid: { nurse: string; shifts: string[] }[]
  ocrDates: string[]
}

interface ShiftEntry {
  nurse: string
  shift: string
}

type ShiftType = 'morning' | 'evening' | 'night'

const shiftHours: Record<ShiftType, number> = {
  morning: 8,
  evening: 8,
  night: 10,
}

function DraggableShift({
  id,
  nurse,
  shift,
  onDelete,
}: {
  id: string
  nurse: string
  shift: string
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id })

  const shiftColor = (shift: string) => {
    switch (shift.toLowerCase()) {
      case 'morning':
        return 'bg-yellow-100 text-yellow-800'
      case 'evening':
        return 'bg-indigo-100 text-indigo-800'
      case 'night':
        return 'bg-slate-200 text-slate-900'
      default:
        return 'bg-blue-100 text-blue-900'
    }
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`text-xs px-2 py-1 rounded-md font-medium shadow-sm cursor-move flex items-center justify-between gap-2 ${
        shiftColor(shift)
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      <span className="whitespace-normal" title={`${nurse}: ${shift}`}>
        {nurse}: {shift} ({shiftHours[shift.toLowerCase() as ShiftType] || 0}h)
      </span>
      <button onClick={onDelete} title="Delete">
        <Trash2 className="w-3.5 h-3.5 text-red-400 hover:text-red-600" />
      </button>
    </div>
  )
}

export default function SchedulePreview({ ocrGrid, ocrDates }: SchedulePreviewProps) {
  // Build originalShiftMap only when ocrGrid or ocrDates change
  const originalShiftMap = useMemo(() => {
    const map = new Map<string, ShiftEntry[]>()
    ocrGrid.forEach(({ nurse, shifts }) => {
      shifts.forEach((shift, i) => {
        const date = ocrDates[i]
        if (!map.has(date)) map.set(date, [])
        if (shift) map.get(date)!.push({ nurse, shift })
      })
    })
    return map
  }, [ocrGrid, ocrDates])

  const [shiftMap, setShiftMap] = useState(new Map(originalShiftMap))
  const [history, setHistory] = useState<Map<string, ShiftEntry[]>[]>([])

  // Reset shiftMap and history when originalShiftMap changes (i.e. props changed)
  useEffect(() => {
    setShiftMap(new Map(originalShiftMap))
    setHistory([])
  }, [originalShiftMap])

  const saveHistory = () => setHistory((prev) => [new Map(shiftMap), ...prev.slice(0, 19)])

  const handleUndo = () => {
    if (history.length > 0) {
      setShiftMap(new Map(history[0]))
      setHistory((prev) => prev.slice(1))
    }
  }

  const handleReset = () => {
    setShiftMap(new Map(originalShiftMap))
    setHistory([])
  }

  const sensors = useSensors(useSensor(PointerSensor))

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const [fromDate, idx] = active.id.toString().split(':')
    const toDate = over.id.toString()

    const draggedShift = shiftMap.get(fromDate)?.[+idx]
    if (!draggedShift) return

    saveHistory()

    const newMap = new Map(shiftMap)
    newMap.set(fromDate, newMap.get(fromDate)!.filter((_, i) => i !== +idx))
    if (!newMap.get(toDate)) newMap.set(toDate, [])
    newMap.get(toDate)!.push(draggedShift)
    setShiftMap(newMap)
  }

  const handleDelete = (date: string, idx: number) => {
    saveHistory()
    const newMap = new Map(shiftMap)
    newMap.set(date, newMap.get(date)!.filter((_, i) => i !== idx))
    setShiftMap(newMap)
  }

  // 7-day grid
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
          <button onClick={handleUndo} title="Undo" className="hover:text-blue-500">
            <Undo2 />
          </button>
          <button onClick={handleReset} title="Reset" className="hover:text-rose-500">
            <RefreshCcw />
          </button>
        </div>
      }
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="space-y-4">
          {rows.map((week, weekIdx) => (
            <div key={weekIdx} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
              {week.map((date, dayIdx) => {
                const parsedDate = parseISO(date)
                const displayDate = format(parsedDate, 'EEE, MMM d')
                const shifts = shiftMap.get(date) || []

                return (
                  <div
                    key={dayIdx}
                    id={date}
                    className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm flex flex-col"
                  >
                    <div className="text-xs font-semibold text-gray-600 mb-2 text-right">{displayDate}</div>
                    <div className="flex flex-col gap-1 min-h-[4rem]">
                      {shifts.length === 0 ? (
                        <div className="text-xs text-gray-300 text-center py-4">No shifts</div>
                      ) : (
                        shifts.map((s, idx) => {
                          const id = `${date}:${idx}`
                          return (
                            <DraggableShift
                              key={id}
                              id={id}
                              nurse={s.nurse}
                              shift={s.shift}
                              onDelete={() => handleDelete(date, idx)}
                            />
                          )
                        })
                      )}
                    </div>
                  </div>
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
