import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Send, Loader2, Sparkles, ShieldAlert } from 'lucide-react'
import { submitTask } from '../lib/api'
import { recordTask } from '../lib/thread'

const EXAMPLES = [
  'Explain the key differences between REST and GraphQL with pros and cons',
  'Write a Python function that implements exponential backoff with jitter',
  'Create a technical comparison of PostgreSQL vs MongoDB for e-commerce',
  'Write a guide on implementing rate limiting in a Node.js API',
  'Summarize the tradeoffs between microservices and monolith architecture',
  'Write unit tests for a user authentication module in TypeScript',
]

/** Deliberately under-specified prompts that reliably trip the Copilot. */
const STRESS_TESTS = [
  'Connect to my local PostgreSQL database at 192.168.1.50 and fix the broken migration in table users_v3',
  'Debug the segfault in my C++ binary at /opt/app/core and patch it',
]

const MIN_CHARS = 12

export default function NewTask() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const trimmed = prompt.trim()
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_CHARS

  const submit = async (text: string) => {
    const value = text.trim()
    if (value.length < MIN_CHARS || loading) return

    setLoading(true)
    setError('')
    try {
      const { task_id } = await submitTask(value)
      recordTask({ taskId: task_id, prompt: value, parentId: null })
      navigate(`/task/${task_id}`)
    } catch (err: any) {
      setError(err?.message || 'Failed to submit. Is the backend running on port 8000?')
    } finally {
      setLoading(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit(prompt)
    }
  }

  return (
    <div className="max-w-3xl p-8">
      <h1 className="text-2xl font-bold text-gray-900">New Task</h1>
      <p className="mb-7 mt-1.5 text-sm leading-relaxed text-gray-500">
        The Coordinator plans it, the Researcher gathers context, the Coder builds it, and the Reviewer
        scores it. The SRE Copilot supervises and repairs weak results before you see them.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit(prompt)
        }}
        className="space-y-4"
      >
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor="prompt" className="block text-sm font-medium text-gray-700">
              What should the agents build?
            </label>
            <span className={`text-xs ${tooShort ? 'text-amber-600' : 'text-gray-400'}`}>
              {trimmed.length} chars
            </span>
          </div>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Be specific about the output you want — format, depth, language, constraints."
            rows={5}
            disabled={loading}
            aria-describedby="prompt-hint"
            className="w-full resize-y rounded-xl border border-gray-200 px-4 py-3 text-sm transition placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15 disabled:bg-gray-50"
          />
          <p id="prompt-hint" className="mt-1.5 text-xs text-gray-400">
            The more specific the brief, the less likely the Copilot has to intervene. Press{' '}
            <kbd className="rounded border border-gray-200 bg-gray-50 px-1 font-mono">Cmd</kbd> +{' '}
            <kbd className="rounded border border-gray-200 bg-gray-50 px-1 font-mono">Enter</kbd> to run.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || trimmed.length < MIN_CHARS}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {loading ? 'Starting pipeline...' : 'Run Pipeline'}
        </button>
      </form>

      {/* Examples */}
      <div className="mt-10">
        <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
          <Sparkles className="h-3 w-3" /> Examples
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setPrompt(ex)}
              disabled={loading}
              className="rounded-lg border border-gray-200 px-3.5 py-3 text-left text-xs leading-relaxed text-gray-600 transition hover:border-indigo-300 hover:bg-white hover:text-gray-900 disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* Stress tests */}
      <div className="mt-8">
        <h2 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-red-500">
          <ShieldAlert className="h-3 w-3" /> Trigger the Copilot
        </h2>
        <p className="mb-3 text-xs text-gray-500">
          These are intentionally under-specified. The agents can't truly solve them, so you'll see anomaly
          detection, healing attempts, and manual mode.
        </p>
        <div className="space-y-2">
          {STRESS_TESTS.map((ex) => (
            <button
              key={ex}
              onClick={() => setPrompt(ex)}
              disabled={loading}
              className="w-full rounded-lg border border-red-100 bg-red-50/50 px-3.5 py-3 text-left text-xs leading-relaxed text-gray-700 transition hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
