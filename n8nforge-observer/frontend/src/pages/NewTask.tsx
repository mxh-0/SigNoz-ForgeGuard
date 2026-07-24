import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Send, Loader2 } from 'lucide-react'
import { submitTask } from '../lib/api'

const EXAMPLES = [
  'Explain the key differences between REST and GraphQL with pros and cons',
  'Write a Python function that implements exponential backoff with jitter',
  'Create a technical comparison of PostgreSQL vs MongoDB for e-commerce',
  'Write a guide on implementing rate limiting in a Node.js API',
  'Summarize the tradeoffs between microservices and monolith architecture',
  'Write unit tests for a user authentication module in TypeScript',
]

export default function NewTask() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim()) return
    setLoading(true)
    setError('')
    try {
      const { task_id } = await submitTask(prompt.trim())
      navigate(`/task/${task_id}`)
    } catch (err: any) {
      setError(err.message || 'Failed to submit. Is the backend running on port 8000?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">New Task</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6">
        Submit a task to the agent pipeline. The Coordinator will decompose it, Researcher gathers info,
        Coder produces the output, and Reviewer scores quality. The SRE Copilot monitors for issues.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Task Description</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you want the agents to produce..."
            rows={5}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 resize-y"
            disabled={loading}
          />
        </div>

        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {loading ? 'Submitting...' : 'Run Pipeline'}
        </button>
      </form>

      {/* Examples */}
      <div className="mt-8">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Examples</h3>
        <div className="grid grid-cols-2 gap-2">
          {EXAMPLES.map(ex => (
            <button
              key={ex}
              onClick={() => setPrompt(ex)}
              disabled={loading}
              className="text-left text-xs px-3 py-2.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-white hover:border-gray-300 transition"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
