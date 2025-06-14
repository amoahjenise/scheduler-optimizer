'use client'
import { WandSparkles, Smile, Meh, Frown } from 'lucide-react'

export default function CharacterAssistant({ status }: { status: 'idle' | 'success' | 'error' | 'loading' }) {
  const expression = {
    idle: <Meh className="text-gray-400" size={32} />,
    success: <Smile className="text-green-500" size={32} />,
    error: <Frown className="text-red-500" size={32} />,
    loading: <WandSparkles className="text-sky-500 animate-spin" size={32} />,
  }

  const message = {
    idle: "I'm standing by...",
    success: "Nice job! Schedule looks great 🎉",
    error: "Oops. Something went wrong!",
    loading: "Working on it...",
  }

  return (
    <div className="fixed bottom-6 right-6 bg-white shadow-xl rounded-2xl p-4 w-64 border border-blue-200">
      <div className="flex items-center gap-3">
        {expression[status]}
        <div className="text-sm font-medium">{message[status]}</div>
      </div>
    </div>
  )
}
