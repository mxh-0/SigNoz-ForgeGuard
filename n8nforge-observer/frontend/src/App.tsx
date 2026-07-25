import { Routes, Route, NavLink, Outlet, Link } from 'react-router-dom'
import { Activity, Send, Eye, BarChart3, Zap, Home } from 'lucide-react'
import clsx from 'clsx'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import NewTask from './pages/NewTask'
import TaskView from './pages/TaskView'
import Analytics from './pages/Analytics'
import ContextInspector from './pages/ContextInspector'

function Layout() {
  const links = [
    { to: '/dashboard', label: 'Dashboard', icon: Activity },
    { to: '/new', label: 'New Task', icon: Send },
    { to: '/analytics', label: 'Observability', icon: BarChart3 },
    { to: '/context', label: 'Context', icon: Eye },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r border-gray-200 bg-white">
        <Link
          to="/"
          className="flex h-16 items-center gap-2 border-b border-gray-100 px-5 transition hover:bg-gray-50"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-bold text-gray-900">SignozForge Observer</span>
        </Link>

        <nav className="flex-1 space-y-1 p-3">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-3 border-t border-gray-100 p-4">
          <Link
            to="/"
            className="flex items-center gap-2 text-xs text-gray-400 transition hover:text-gray-600"
          >
            <Home className="h-3 w-3" /> Landing page
          </Link>
          <div>
            <div className="text-xs text-gray-400">SRE Copilot v2.0</div>
            <div className="text-xs text-gray-400">RAM Context Store</div>
          </div>
        </div>
      </aside>

      <main className="ml-56 min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      {/* Public landing page — no app chrome */}
      <Route path="/" element={<Landing />} />

      {/* App shell */}
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/new" element={<NewTask />} />
        <Route path="/task/:taskId" element={<TaskView />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/context" element={<ContextInspector />} />
      </Route>
    </Routes>
  )
}
