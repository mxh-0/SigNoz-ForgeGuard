import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Copy, CheckCircle2, AlertTriangle, XCircle, Shield, StopCircle } from 'lucide-react'
import { getTask, subscribeToTask, cancelTask, type TaskResult } from '../lib/api'

export default function TaskView() {
  const { taskId } = useParams<{ taskId: string }>()
  const [task, setTask] = useState<TaskResult | null>(null)
  const [events, setEvents] = useState<Array<{ step: string; status: string; message: string }>>([])
  const [copied, setCopied] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (!taskId) return

    // Start SSE stream for live updates
    const close = subscribeToTask(taskId, (ev, data) => {
      if (ev === 'status') {
        setEvents(prev => [...prev, data])
      }
      if (ev === 'complete' || ev === 'error') {
        // Fetch final result
        getTask(taskId).then(setTask).catch(() => {})
      }
    })

    // Also poll for the result (in case SSE missed)
    const poll = setInterval(() => {
      getTask(taskId).then(t => {
        setTask(t)
        if (t.status !== 'running') clearInterval(poll)
      }).catch(() => {})
    }, 3000)

    return () => { close(); clearInterval(poll) }
  }, [taskId])

  const copyOutput = () => {
    if (task?.final_output) {
      navigator.clipboard.writeText(task.final_output)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleCancel = async () => {
    if (!taskId) return
    setCancelling(true)
    try {
      await cancelTask(taskId)
      setTask(prev => prev ? { ...prev, status: 'cancelled' } : null)
    } catch { }
    setCancelling(false)
  }

  const isRunning = !task || task.status === 'running'
  const isSuccess = task?.status === 'success'
  const isManual = task?.status === 'manual_mode'
  const isError = task?.status === 'error'
  const isCancelled = task?.status === 'cancelled'

  return (
    <div className="p-8 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/" className="p-2 hover:bg-gray-100 rounded-lg transition">
          <ArrowLeft className="w-4 h-4 text-gray-500" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-gray-900">Task</h1>
            <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono text-gray-600">{taskId}</code>
            {isRunning && <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full animate-pulse">Running</span>}
            {isSuccess && <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full">Complete</span>}
            {isManual && <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full">Manual Mode</span>}
            {isError && <span className="text-xs px-2 py-0.5 bg-red-50 text-red-700 rounded-full">Error</span>}
            {isCancelled && <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">Ended</span>}
          </div>
          {task && <p className="text-sm text-gray-500 mt-1 truncate">{task.prompt}</p>}
        </div>
        {isRunning && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition disabled:opacity-50"
          >
            <StopCircle className="w-3.5 h-3.5" />
            {cancelling ? 'Ending...' : 'End Task'}
          </button>
        )}
      </div>

      {/* Progress / Events */}
      {(isRunning || events.length > 0) && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-500 uppercase">Live Pipeline</span>
          </div>
          <div className="p-4 space-y-2 max-h-60 overflow-y-auto">
            {events.map((ev, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  ev.status === 'done' ? 'bg-emerald-500' :
                  ev.status === 'running' ? 'bg-blue-500 animate-pulse' :
                  ev.status === 'failed' ? 'bg-red-500' :
                  ev.status === 'healing' ? 'bg-amber-500' : 'bg-gray-300'
                }`} />
                <span className="font-medium text-gray-700 w-20 flex-shrink-0">{ev.step}</span>
                <span className="text-gray-500 truncate">{ev.message}</span>
              </div>
            ))}
            {isRunning && events.length === 0 && (
              <div className="text-sm text-gray-400 animate-pulse">Starting pipeline...</div>
            )}
          </div>
        </div>
      )}

      {/* Copilot healing info */}
      {task && task.fix_history.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-amber-900">SRE Copilot Interventions ({task.fix_history.length})</h3>
          </div>
          <div className="space-y-2">
            {task.fix_history.map(fix => (
              <div key={fix.attempt} className="flex items-start gap-3 text-sm">
                <span className={`mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  fix.result === 'success' ? 'bg-emerald-100 text-emerald-700' :
                  fix.result === 'fail' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                }`}>{fix.result}</span>
                <div>
                  <p className="font-medium text-amber-800">Attempt {fix.attempt} — {fix.strategy}</p>
                  <p className="text-amber-700 text-xs mt-0.5 line-clamp-2">{fix.action}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Output */}
      {task?.final_output && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase">Output</span>
            <button onClick={copyOutput} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-50">
              <Copy className="w-3 h-3" /> {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="p-5 prose prose-sm max-w-none text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
            {task.final_output}
          </div>
        </div>
      )}

      {/* Error */}
      {task?.error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-sm font-semibold text-red-800">Error</span>
          </div>
          <pre className="text-xs text-red-700 font-mono whitespace-pre-wrap">{task.error}</pre>
        </div>
      )}

      {/* Steps detail */}
      {task && task.steps.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-500 uppercase">Step Details</span>
          </div>
          <div className="divide-y divide-gray-50">
            {task.steps.map(step => (
              <div key={step.name} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${step.status === 'done' ? 'bg-emerald-500' : step.status === 'failed' ? 'bg-red-500' : 'bg-gray-300'}`} />
                    <span className="text-sm font-semibold text-gray-800">{step.name}</span>
                    <span className="text-xs text-gray-400">({step.agent})</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>{step.tokens} tokens</span>
                    <span>{step.latency_ms > 0 ? `${step.latency_ms.toFixed(0)}ms` : '-'}</span>
                  </div>
                </div>
                {step.output && (
                  <pre className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 max-h-32 overflow-y-auto whitespace-pre-wrap">
                    {step.output.slice(0, 500)}{step.output.length > 500 ? '...' : ''}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      {task && task.status !== 'running' && (
        <div className="flex items-center gap-6 text-xs text-gray-500 px-1">
          <span>Total tokens: <strong className="text-gray-700">{task.total_tokens}</strong></span>
          <span>Retries: <strong className="text-gray-700">{task.retry_count}</strong></span>
          <span>Mode: <strong className="text-gray-700">{task.mode}</strong></span>
        </div>
      )}
    </div>
  )
}
