import { useEffect, useState } from 'react'
import { Activity, Zap, Clock, Shield, TrendingUp, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { getSigNozMetrics, getSigNozHealth, type SigNozMetrics } from '../lib/api'

export default function Analytics() {
  const [metrics, setMetrics] = useState<SigNozMetrics | null>(null)
  const [sigNozAvailable, setSigNozAvailable] = useState<boolean | null>(null)
  const [sigNozEndpoint, setSigNozEndpoint] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      const health = await getSigNozHealth()
      setSigNozAvailable(health.available)
      setSigNozEndpoint(health.endpoint)

      const m = await getSigNozMetrics()
      setMetrics(m)
      setLoading(false)
    }
    fetch()
    const interval = setInterval(fetch, 15000) // Refresh every 15s
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Observability</h1>
        <p className="text-sm text-gray-500 mt-1">
          Live system health powered by SigNoz -- traces, metrics, and Copilot intelligence
        </p>
      </div>

      {/* SigNoz Connection Status */}
      <div className={`rounded-xl border p-4 flex items-center justify-between ${
        sigNozAvailable === null ? 'bg-gray-50 border-gray-200' :
        sigNozAvailable ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
      }`}>
        <div className="flex items-center gap-3">
          <Activity className={`w-5 h-5 ${
            sigNozAvailable ? 'text-emerald-600' : 'text-amber-600'
          }`} />
          <div>
            <p className={`text-sm font-semibold ${
              sigNozAvailable ? 'text-emerald-900' : 'text-amber-900'
            }`}>
              SigNoz {sigNozAvailable ? 'Connected' : sigNozAvailable === null ? 'Checking...' : 'Unavailable'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {sigNozAvailable
                ? `Receiving traces and metrics at ${sigNozEndpoint}`
                : 'Start SigNoz with: docker compose up -d'}
            </p>
          </div>
        </div>
        {sigNozAvailable && (
          <a
            href="http://localhost:3301"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-emerald-700 hover:text-emerald-900 px-3 py-1.5 bg-emerald-100 rounded-lg transition"
          >
            Open SigNoz Dashboard
          </a>
        )}
      </div>

      {/* Live Metrics Grid */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          icon={<Clock className="w-4 h-4 text-blue-500" />}
          label="LLM Avg Latency"
          value={metrics ? `${metrics.llm.avg_latency_ms.toFixed(0)}ms` : '--'}
          sub={metrics?.llm.p95_latency_ms ? `p95: ${metrics.llm.p95_latency_ms.toFixed(0)}ms` : ''}
          status={metrics?.llm.is_degraded ? 'degraded' : 'ok'}
        />
        <MetricCard
          icon={<Shield className="w-4 h-4 text-amber-500" />}
          label="Healing Attempts"
          value={metrics ? `${metrics.healing.total_attempts}` : '--'}
          sub={metrics?.healing.total_attempts ? `${(metrics.healing.success_rate * 100).toFixed(0)}% success` : 'No attempts yet'}
          status={metrics && metrics.healing.success_rate < 0.3 && metrics.healing.total_attempts > 2 ? 'degraded' : 'ok'}
        />
        <MetricCard
          icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
          label="Healing Successes"
          value={metrics ? `${metrics.healing.success_count}` : '--'}
          sub="Auto-fixes that worked"
          status="ok"
        />
        <MetricCard
          icon={<Zap className="w-4 h-4 text-indigo-500" />}
          label="LLM Error Rate"
          value={metrics ? `${(metrics.llm.error_rate * 100).toFixed(1)}%` : '--'}
          sub="Timeouts + rate limits"
          status={metrics && metrics.llm.error_rate > 0.1 ? 'degraded' : 'ok'}
        />
      </div>

      {/* Agent Step Performance */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 text-sm mb-4">Agent Step Performance (from SigNoz traces)</h2>
        <div className="grid grid-cols-3 gap-4">
          {(['research', 'code', 'review'] as const).map(step => {
            const data = metrics?.steps[step]
            return (
              <div key={step} className={`p-4 rounded-lg border ${
                data?.is_degraded ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-gray-50'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-800 capitalize">{step}</span>
                  {data?.is_degraded && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Avg Latency</span>
                    <span className="font-medium text-gray-700">
                      {data ? `${data.avg_latency_ms.toFixed(0)}ms` : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Error Rate</span>
                    <span className={`font-medium ${
                      data && data.error_rate > 0.1 ? 'text-red-600' : 'text-gray-700'
                    }`}>
                      {data ? `${(data.error_rate * 100).toFixed(1)}%` : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Status</span>
                    <span className={`font-medium ${
                      data?.is_degraded ? 'text-red-600' : 'text-emerald-600'
                    }`}>
                      {data?.is_degraded ? 'Degraded' : 'Healthy'}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* How SigNoz is Used */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 text-sm mb-4">How SigNoz Powers the SRE Copilot</h2>
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase">What We Export to SigNoz</h3>
            <div className="space-y-2">
              {[
                { span: 'agent.coordinator', desc: 'Task decomposition trace' },
                { span: 'agent.researcher', desc: 'Research step with token count' },
                { span: 'agent.coder', desc: 'Code generation with output length' },
                { span: 'agent.reviewer', desc: 'Review with semantic_score' },
                { span: 'copilot.evaluate', desc: 'Anomaly detection decisions' },
                { span: 'copilot.heal', desc: 'Healing attempts with strategy' },
                { span: 'llm.call', desc: 'Every LLM call with latency + model' },
              ].map(s => (
                <div key={s.span} className="flex items-start gap-2">
                  <code className="text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded font-mono flex-shrink-0">{s.span}</code>
                  <span className="text-xs text-gray-600">{s.desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase">What We Read from SigNoz</h3>
            <div className="space-y-3">
              <div className="border-l-2 border-indigo-300 pl-3">
                <p className="text-xs font-medium text-gray-700">Step Health History</p>
                <p className="text-xs text-gray-500">Avg latency + error rate per step over last 30 min. Used to detect degradation.</p>
              </div>
              <div className="border-l-2 border-indigo-300 pl-3">
                <p className="text-xs font-medium text-gray-700">LLM Provider Health</p>
                <p className="text-xs text-gray-500">Current p95 latency + rate limit hits. Informs retry strategy.</p>
              </div>
              <div className="border-l-2 border-indigo-300 pl-3">
                <p className="text-xs font-medium text-gray-700">Healing Success Rate</p>
                <p className="text-xs text-gray-500">Historical fix success %. If low, Copilot adjusts its fix hints aggressively.</p>
              </div>
              <div className="border-l-2 border-red-300 pl-3">
                <p className="text-xs font-medium text-gray-700">Recent Error Traces</p>
                <p className="text-xs text-gray-500">Error spans from SigNoz feed context into the Copilot's healing prompt.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Custom Metrics */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 text-sm mb-4">Custom Metrics (exported to SigNoz)</h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            { name: 'signozforge.tasks.submitted', type: 'Counter', desc: 'Total tasks submitted' },
            { name: 'signozforge.tasks.completed', type: 'Counter', desc: 'Successful completions' },
            { name: 'signozforge.tasks.failed', type: 'Counter', desc: 'Errors + manual mode' },
            { name: 'signozforge.copilot.anomalies_detected', type: 'Counter', desc: 'Anomalies caught' },
            { name: 'signozforge.copilot.healing_attempts', type: 'Counter', desc: 'Fix attempts triggered' },
            { name: 'signozforge.copilot.healing_successes', type: 'Counter', desc: 'Fixes that worked' },
            { name: 'signozforge.copilot.manual_mode_triggers', type: 'Counter', desc: 'Manual mode switches' },
            { name: 'signozforge.llm.calls_total', type: 'Counter', desc: 'Total LLM API calls' },
            { name: 'signozforge.llm.errors_total', type: 'Counter', desc: 'LLM errors (timeout/rate limit)' },
            { name: 'signozforge.llm.latency_ms', type: 'Histogram', desc: 'LLM call latency distribution' },
            { name: 'signozforge.agent.step_latency_ms', type: 'Histogram', desc: 'Agent step duration' },
          ].map(m => (
            <div key={m.name} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50">
              <code className="text-[10px] font-mono text-gray-700 flex-1 truncate">{m.name}</code>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium flex-shrink-0">{m.type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}


function MetricCard({ icon, label, value, sub, status }: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
  status: 'ok' | 'degraded'
}) {
  return (
    <div className={`bg-white rounded-xl border p-4 ${
      status === 'degraded' ? 'border-red-200' : 'border-gray-200'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs font-medium text-gray-500">{label}</span>
      </div>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-400 mt-1">{sub}</p>
    </div>
  )
}
