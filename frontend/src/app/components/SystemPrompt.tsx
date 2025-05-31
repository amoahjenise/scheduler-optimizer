'use client'

import { useState, useEffect, useRef } from 'react'
import { Stethoscope, Eye, EyeOff } from 'lucide-react'
import SectionCard from './SectionCard'
import { fetchSystemPromptsAPI, saveSystemPromptAPI, resetSystemPromptAPI } from '@/app/lib/api'

export default function SystemPrompt() {
  const [editablePrompt, setEditablePrompt] = useState('')
  const [loadingPrompt, setLoadingPrompt] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [showFullPreview, setShowFullPreview] = useState(false)

  const originalPrompt = useRef('')

  const requiredPlaceholders = [
    '{start_date}',
    '{end_date}',
    '{nurses_list}',
    '{notes}',
    '{rules_lines}',
    '{comments_json}',
    '{assignments_json}',
  ]

  const immutableSection = `Return ONLY a valid JSON object in the format:
{{
  "Nurse Name (ID, Experience, Hours)": ["shift_1", "shift_2", ..., "shift_N"]
}}

The schedule optimization must fully cover the entire period;

IMPORTANT: Return ONLY the JSON object without any explanations, comments, or additional text.`

  useEffect(() => {
    async function loadPrompt() {
      setLoadingPrompt(true)
      setPromptError(null)
      try {
        const data = await fetchSystemPromptsAPI()
        const prompt = data.content || ''
        const [editable, immutable] = prompt.split(immutableSection)
        setEditablePrompt(editable.trim())
        originalPrompt.current = editable.trim()
        setHasChanges(false)
        setIsEditing(false)
      } catch (error: any) {
        setPromptError(error.message || 'Failed to load system prompt')
      } finally {
        setLoadingPrompt(false)
      }
    }
    loadPrompt()
  }, [])

  function onChangePrompt(value: string) {
    setEditablePrompt(value)
    setHasChanges(value !== originalPrompt.current)
    if (promptError) setPromptError(null)
  }

  function validateBeforeSave(text: string) {
    const missing = requiredPlaceholders.filter(ph => !text.includes(ph))
    if (missing.length > 0) {
      return `Missing required placeholders: ${missing.join(', ')}`
    }
    return null
  }

  async function savePrompt() {
    setSavingPrompt(true)
    setPromptError(null)

    const error = validateBeforeSave(editablePrompt)
    if (error) {
      setPromptError(error)
      setSavingPrompt(false)
      return
    }

    try {
      const fullPrompt = `${editablePrompt.trim()}\n\n${immutableSection}`
      await saveSystemPromptAPI('global', fullPrompt)
      alert('System prompt saved!')
      originalPrompt.current = editablePrompt.trim()
      setHasChanges(false)
      setIsEditing(false)
    } catch (error: any) {
      setPromptError(error.message || 'Failed to save system prompt')
    } finally {
      setSavingPrompt(false)
    }
  }

  function cancelEditing() {
    setEditablePrompt(originalPrompt.current)
    setHasChanges(false)
    setPromptError(null)
    setIsEditing(false)
  }

  async function resetPrompt() {
    setLoadingPrompt(true)
    setPromptError(null)
    try {
      const data = await resetSystemPromptAPI()
      const prompt = data.content || ''
      const [editable, _] = prompt.split(immutableSection)
      setEditablePrompt(editable.trim())
      originalPrompt.current = editable.trim()
      alert('System prompt reset to default!')
      setHasChanges(false)
      setIsEditing(false)
    } catch (error: any) {
      setPromptError(error.message || 'Failed to reset system prompt')
    } finally {
      setLoadingPrompt(false)
    }
  }

  return (
    <SectionCard title="System Prompt" icon={<Stethoscope className="text-sky-600" />} className="w-full">
      {loadingPrompt ? (
        <p>Loading prompt...</p>
      ) : (
        <>
          {promptError && <p className="text-red-600 mb-2">{promptError}</p>}

          <p className="mb-3 text-gray-700">
            This system prompt guides the optimizer’s behavior. These placeholders must remain untouched:
            {requiredPlaceholders.map(ph => (
              <code key={ph} className="bg-gray-100 px-1 rounded mx-0.5 font-mono text-sm">{ph}</code>
            ))}
          </p>

          {isEditing ? (
            <>
              <textarea
                value={editablePrompt}
                onChange={(e) => onChangePrompt(e.target.value)}
                rows={10}
                className="w-full border border-blue-300 rounded-md p-3 resize-y focus:outline-none focus:ring-2 focus:ring-sky-400 font-mono"
                spellCheck={false}
              />
              <div className="mt-4 p-4 bg-yellow-100 border-l-4 border-yellow-500 font-mono text-sm text-gray-800 whitespace-pre-wrap rounded">
                {immutableSection}
              </div>
            </>
          ) : (
            <div className="relative">
              <pre
                className={`whitespace-pre-wrap p-4 border border-blue-300 rounded-md bg-gray-50 text-gray-800 font-mono transition-all duration-300 ${
                    showFullPreview ? 'max-h-[600px] overflow-auto' : 'max-h-[160px] overflow-hidden'
                }`}
                >
                {`${editablePrompt.trim()}\n\n${immutableSection}`}
              </pre>
              <button
                onClick={() => setShowFullPreview(prev => !prev)}
                className="text-sm text-blue-600 hover:underline mt-2 flex items-center gap-1"
              >
                {showFullPreview ? <><EyeOff size={16} /> Hide Preview</> : <><Eye size={16} /> Show Full Preview</>}
              </button>
            </div>
          )}

          <div className="flex gap-2 mt-4">
            {isEditing ? (
              <>
                <button
                  onClick={savePrompt}
                  disabled={savingPrompt || !hasChanges}
                  className={`px-4 py-2 rounded-md font-medium text-white ${
                    savingPrompt || !hasChanges
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {savingPrompt ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={cancelEditing}
                  disabled={savingPrompt}
                  className="px-4 py-2 rounded-md font-medium bg-gray-300 hover:bg-gray-400"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 rounded-md font-medium text-white bg-blue-600 hover:bg-blue-700"
              >
                Edit
              </button>
            )}

            <button
              onClick={resetPrompt}
              disabled={loadingPrompt || savingPrompt}
              className={`px-4 py-2 rounded-md font-medium text-white ${
                loadingPrompt ? 'bg-gray-400 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {loadingPrompt ? 'Resetting...' : 'Reset to Default'}
            </button>
          </div>
        </>
      )}
    </SectionCard>
  )
}
