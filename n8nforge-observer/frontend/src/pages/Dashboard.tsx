import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, XCircle, Clock, Zap, ArrowRight, History, GitBranch, Trash2 } from 'lucide-react'
import { checkHealth, getActiveContexts, cancelTask } from '../lib/api'
import { getRecentTasks, removeTask, clearAllTasks, type ThreadNode } from '../lib/thread'

function relativeTime(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export default function Dashboard() {
  const [healthy, setHealthy] = useState<boolean | null>(null)
  const [activeTasks, setActiveTasks] = useState<string[]>([])
  const [recent, setRecent] = useState<ThreadNode[]>([])

  useEffect(() => {
    const check = async () => {
      setHealthy(await checkHealth())
      const ctx = await getActiveContexts()
      setActiveTasks(ctx.active_tasks)
      setRecent(getRecentTasks(8))
    }
    check()
    const i = setInterval(check, 5000)
    return () => clearInterval(i)
  }, [])

  const activeSet = useMemo(() => new Set(activeTasks), [activeTasks])

  return (
    <div className="space-y-7 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">Pipeline overview and system health</p>
        </div>
        <Link
          to="/new"
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          <Zap className="h-4 w-4" /> New Task
        </Link>
      </div>

      {/* Status cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-500">Backend</span>
            {healthy === null ? (
              <Clock className="h-4 w-4 text-gray-400" />
            ) : healthy ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900">
            {healthy === null ? '...' : healthy ? 'Online' : 'Offline'}
          </p>
          {healthy === false && <p className="mt-1 text-xs text-red-500">Start it on port 8000</p>}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <span className="text-sm font-medium text-gray-500">Active Tasks</span>
          <p className="mt-2 text-2xl font-bold text-gray-900">{activeTasks.length}</p>
          <p className="mt-1 text-xs text-gray-400">In the pipeline now</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <span className="text-sm font-medium text-gray-500">Copilot Mode</span>
          <p className="mt-2 text-2xl font-bold text-gray-900">Automatic</p>
          <p className="mt-1 text-xs text-gray-400">2-strike cap</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <span className="text-sm font-medium text-gray-500">Context Store</span>
          <p className="mt-2 text-2xl font-bold text-gray-900">RAM</p>
          <p className="mt-1 text-xs text-gray-400">Ephemeral, per-task</p>
        </div>
      </div>

      {/* Active tasks */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Active Pipeline Tasks</h2>
          <span className="text-xs text-gray-400">{activeTasks.length} running</span>
        </div>
        {activeTasks.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-gray-500">No active tasks. Submit one to see the pipeline in action.</p>
            <Link
              to="/new"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 transition hover:text-indigo-800"
            >
              Submit a task <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {activeTasks.map((id) => (
              <div
                key={id}
                className="flex items-center justify-between px-6 py-4 transition hover:bg-gray-50"
              >
                <Link to={`/task/${id}`} className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
                  <code className="font-mono text-sm text-gray-700">{id}</code>
                </Link>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                    running
                  </span>
                  <button
                    onClick={async (e) => {
                      e.preventDefault()
                      try { await cancelTask(id) } catch {}
                      removeTask(id)
                      setActiveTasks((prev) => prev.filter((t) => t !== id))
                    }}
                    title="End this task"
                    className="rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent history (client-side) */}
      {recent.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <div className="flex items-center gap-2">
              <History className="h-3.5 w-3.5 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-900">Recent Tasks</h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">this browser</span>
              <button
                onClick={() => {
                  clearAllTasks()
                  setRecent([])
                }}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-gray-400 transition hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-3 w-3" /> Clear all
              </button>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {recent.map((node) => (
              <div
                key={node.taskId}
                className="flex items-start justify-between gap-4 px-6 py-3.5 transition hover:bg-gray-50"
              >
                <Link
                  to={`/task/${node.taskId}`}
                  className="min-w-0 flex-1"
                >
                  <p className="truncate text-sm text-gray-800">{node.prompt}</p>
                  <div className="mt-1 flex items-center gap-2.5">
                    <code className="font-mono text-[11px] text-gray-400">{node.taskId}</code>
                    {node.parentId && (
                      <span className="flex items-center gap-1 text-[11px] text-indigo-500">
                        <GitBranch className="h-2.5 w-2.5" /> revision
                      </span>
                    )}
                  </div>
                </Link>
                <div className="flex flex-shrink-0 items-center gap-2.5">
                  {activeSet.has(node.taskId) && (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
                  )}
                  <span className="text-[11px] text-gray-400">{relativeTime(node.createdAt)}</span>
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      removeTask(node.taskId)
                      setRecent((prev) => prev.filter((n) => n.taskId !== node.taskId))
                    }}
                    title="Remove from history"
                    className="rounded-lg p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Architecture */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Pipeline Architecture</h2>
        <div className="flex items-center gap-3 overflow-x-auto py-2">
          {['Task Intake', 'Coordinator', 'Researcher', 'Coder', 'Reviewer', 'SRE Copilot', 'Output'].map(
            (s, i, arr) => (
              <div key={s} className="flex flex-shrink-0 items-center gap-3">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <span className="text-xs font-medium text-gray-700">{s}</span>
                </div>
                {i < arr.length - 1 && <ArrowRight className="h-3 w-3 text-gray-300" />}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  )
}
