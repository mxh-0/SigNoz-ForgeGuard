import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, XCircle, Clock, Zap, ArrowRight } from 'lucide-react'
import { checkHealth, getActiveContexts } from '../lib/api'

export default function Dashboard() {
  const [healthy, setHealthy] = useState<boolean | null>(null)
  const [activeTasks, setActiveTasks] = useState<string[]>([])
  const [stats, setStats] = useState({ total: 0, success: 0, healed: 0, manual: 0 })

  useEffect(() => {
    const check = async () => {
      setHealthy(await checkHealth())
      const ctx = await getActiveContexts()
      setActiveTasks(ctx.active_tasks)
    }
    check()
    const i = setInterval(check, 5000)
    return () => clearInterval(i)
  }, [])

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Pipeline overview and system health</p>
        </div>
        <Link to="/new" className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition">
          <Zap className="w-4 h-4" /> New Task
        </Link>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-500">Backend</span>
            {healthy === null ? <Clock className="w-4 h-4 text-gray-400" /> :
             healthy ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> :
             <XCircle className="w-4 h-4 text-red-500" />}
          </div>
          <p className="text-2xl font-bold mt-2 text-gray-900">
            {healthy === null ? '...' : healthy ? 'Online' : 'Offline'}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <span className="text-sm font-medium text-gray-500">Active Tasks</span>
          <p className="text-2xl font-bold mt-2 text-gray-900">{activeTasks.length}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <span className="text-sm font-medium text-gray-500">Copilot Mode</span>
          <p className="text-2xl font-bold mt-2 text-gray-900">Automatic</p>
          <p className="text-xs text-gray-400 mt-1">2-strike cap</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <span className="text-sm font-medium text-gray-500">Context Store</span>
          <p className="text-2xl font-bold mt-2 text-gray-900">RAM</p>
          <p className="text-xs text-gray-400 mt-1">Ephemeral, per-task</p>
        </div>
      </div>

      {/* Active tasks */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 text-sm">Active Pipeline Tasks</h2>
          <span className="text-xs text-gray-400">{activeTasks.length} running</span>
        </div>
        {activeTasks.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-gray-500">No active tasks. Submit one to see the pipeline in action.</p>
            <Link to="/new" className="mt-3 inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800">
              Submit a task <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {activeTasks.map(id => (
              <Link key={id} to={`/task/${id}`} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                  <code className="text-sm font-mono text-gray-700">{id}</code>
                </div>
                <span className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded-full font-medium">running</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Architecture */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 text-sm mb-4">Pipeline Architecture</h2>
        <div className="flex items-center gap-3 overflow-x-auto py-2">
          {['Task Intake', 'Coordinator', 'Researcher', 'Coder', 'Reviewer', 'SRE Copilot', 'Output'].map((s, i, arr) => (
            <div key={s} className="flex items-center gap-3 flex-shrink-0">
              <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                <span className="text-xs font-medium text-gray-700">{s}</span>
              </div>
              {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-gray-300" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
