import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Loader2, MessageSquarePlus, Sparkles } from 'lucide-react'
import { submitTask } from '../lib/api'
import { buildFollowUpPrompt, recordTask } from '../lib/thread'

const QUICK_ACTIONS = [
  { label: 'Add code examples', instruction: 'Add complete, runnable code examples for every concept covered.' },
  { label: 'Make it more concise', instruction: 'Cut this down to the essentials. Remove all filler and repetition.' },
  { label: 'Go deeper', instruction: 'Go significantly deeper on the technical details, tradeoffs, and edge cases.' },
  { label: 'Add a summary table', instruction: 'Add a comparison table that summarises the key points side by side.' },
  { label: 'Be more specific', instruction: 'Replace all generic advice with specific, concrete, actionable steps.' },
  { label: 'Add tests', instruction: 'Add unit tests covering the happy path and the important edge cases.' },
]

interface Props {
  taskId: string
  originalPrompt: string
  previousOutput: string
  /** Disabled while the parent task is still running. */
  disabled?: boolean
}

export default function FollowUpComposer({ taskId, originalPrompt, previousOutput, disabled }: Props) {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const run = async (instruction: string) => {
    const followUp = instruction.trim()
    if (!followUp || submitting) return

    setSubmitting(true)
    setError('')
    try {
      const prompt = buildFollowUpPrompt(originalPrompt, previousOutput, followUp)
      const { task_id } = await submitTask(prompt)
      recordTask({ taskId: task_id, prompt: originalPrompt, parentId: taskId, followUp })
      setValue('')
      navigate(`/task/${task_id}`)
    } catch (err: any) {
      setError(err?.message || 'Could not start the follow-up run.')
    } finally {
      setSubmitting(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      run(value)
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3">
        <MessageSquarePlus className="h-4 w-4 text-indigo-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Refine this result
        </span>
      </div>

      <div className="space-y-3 p-5">
        <p className="text-[13px] text-gray-500">
          Ask for a change and the pipeline runs again with the previous result as context.
        </p>

        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.label}
              onClick={() => run(a.instruction)}
              disabled={disabled || submitting}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-3 w-3" />
              {a.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <label htmlFor="followup" className="sr-only">
            Describe the change you want
          </label>
          <textarea
            id="followup"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            disabled={disabled || submitting}
            placeholder={
              disabled ? 'Available once the task finishes...' : 'e.g. rewrite this in TypeScript and add error handling'
            }
            className="w-full resize-y rounded-xl border border-gray-200 px-4 py-3 pr-28 text-sm text-gray-800 transition placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            onClick={() => run(value)}
            disabled={disabled || submitting || !value.trim()}
            className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CornerDownLeft className="h-3.5 w-3.5" />}
            {submitting ? 'Starting' : 'Send'}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-100 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">{error}</div>
        )}

        <p className="text-[11px] text-gray-400">
          Tip: press <kbd className="rounded border border-gray-200 bg-gray-50 px-1 font-mono">Cmd</kbd> +{' '}
          <kbd className="rounded border border-gray-200 bg-gray-50 px-1 font-mono">Enter</kbd> to send
        </p>
      </div>
    </div>
  )
}
