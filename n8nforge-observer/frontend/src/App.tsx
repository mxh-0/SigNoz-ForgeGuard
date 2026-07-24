import { Routes, Route, NavLink, Outlet } from 'react-router-dom'
import { Activity, Send, Eye, BarChart3, Zap } from 'lucide-react'
import clsx from 'clsx'
import Dashboard from './pages/Dashboard'
import NewTask from './pages/NewTask'
import TaskView from './pages/TaskView'
import Analytics from './pages/Analytics'
import ContextInspector from './pages/ContextInspector'

function Layout() {
  const links = [
    { to: '/', label: 'Dashboard', icon: Activity },
    { to: '/new', label: 'New Task', icon: Send },
    { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    { to: '/context', label: 'Context', icon: Eye },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 w-56 bg-white border-r border-gray-200 flex flex-col z-40">
        <div className="h-16 flex items-center px-5 border-b border-gray-100">
          <Zap className="w-5 h-5 text-indigo-600" />
          <span className="ml-2 font-bold text-gray-900 text-sm">n8nForge Observer</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-100">
          <div className="text-xs text-gray-400">SRE Copilot v2.0</div>
          <div className="text-xs text-gray-400">RAM Context Store</div>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-56 min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/new" element={<NewTask />} />
        <Route path="/task/:taskId" element={<TaskView />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/context" element={<ContextInspector />} />
      </Route>
    </Routes>
  )
}
