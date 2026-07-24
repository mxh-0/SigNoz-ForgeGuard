import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Eye, Search, RefreshCw } from 'lucide-react'
import { getContext, getActiveContexts } from '../lib/api'

export default function ContextInspector() {
  const [searchParams] = useSearchParams()
  const [taskId, setTaskId] = useState(searchParams.get('id') || '')
  const [snapshot, setSnapshot] = useState<any>(null)
  const [active, setActive] = useState<string[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    getActiveContexts().then(c => setActive(c.active_tasks)).catch(() => {})
  }, [])

  const load = async (id?: string) => {
    const target = id || taskId.trim()
    if (!target) return
    setError('')
    setSnapshot(null)
    const data = await getContext(target)
    if (data) setSnapshot(data)
    else setError('Context not found — task may have completed and RAM was cleared.')
  }

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Context Inspector</h1>
        <p className="text-sm text-gray-500 mt-1">
          View live RAM context for in-flight tasks. Returns empty when task completes (RAM cleared).
        </p>
      </div>

      {/* Search */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={taskId}
            onChange={e => setTaskId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
            placeholder="Enter task_id..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
        <button onClick={() => load()} className="px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-2">
          <Eye className="w-4 h-4" /> Inspect
        </button>
      </div>

      {/* Quick access */}
      {active.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400">Active:</span>
          {active.map(id => (
            <button key={id} onClick={() => { setTaskId(id); load(id) }}
              className="text-xs px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full font-mono hover:bg-indigo-100">
              {id}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-center">
          <Eye className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-600">{error}</p>
        </div>
      )}

      {snapshot && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-600">RAM Snapshot</span>
            <button onClick={() => load()} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>
          <pre className="p-5 text-xs font-mono text-gray-700 overflow-x-auto max-h-[600px] overflow-y-auto whitespace-pre-wrap">
            {JSON.stringify(snapshot, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
