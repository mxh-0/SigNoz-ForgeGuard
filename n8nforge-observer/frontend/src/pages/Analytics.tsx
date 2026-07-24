import { BarChart3, Zap, Clock, Shield, TrendingUp } from 'lucide-react'

export default function Analytics() {
  // In production, these would come from stored task history
  // For now, show the metrics the system tracks
  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Pipeline performance, token usage, and healing metrics</p>
      </div>

      {/* Metrics cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <Zap className="w-4 h-4 text-indigo-500" /> Token Usage
          </div>
          <p className="text-xs text-gray-500">
            Tracks total tokens consumed per task across all 4 agents (Coordinator, Researcher, Coder, Reviewer).
            Visible per-step in task details.
          </p>
          <div className="text-xs text-gray-400">Metric: total_tokens per task</div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <Clock className="w-4 h-4 text-emerald-500" /> Latency
          </div>
          <p className="text-xs text-gray-500">
            Per-step latency in milliseconds. Tracks each LLM call independently.
            Used by the Copilot for spike detection (3x baseline = anomaly).
          </p>
          <div className="text-xs text-gray-400">Metric: latency_ms per step</div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <Shield className="w-4 h-4 text-amber-500" /> Copilot Interventions
          </div>
          <p className="text-xs text-gray-500">
            How often the SRE Copilot intervenes: retry count, strategy used (reword vs rethink),
            and success rate of auto-fixes vs manual escalations.
          </p>
          <div className="text-xs text-gray-400">Metric: retry_count, fix_history</div>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 text-sm mb-4">How the SRE Copilot Works</h2>
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase">Anomaly Signals</h3>
            <div className="space-y-2">
              {[
                { signal: 'LOW_SCORE', desc: 'Reviewer semantic score < 0.6' },
                { signal: 'AGENT_ERROR', desc: 'Exception thrown during step execution' },
                { signal: 'EMPTY_OUTPUT', desc: 'Agent returned < 20 chars' },
              ].map(s => (
                <div key={s.signal} className="flex items-start gap-2">
                  <code className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-700 rounded font-mono flex-shrink-0">{s.signal}</code>
                  <span className="text-xs text-gray-600">{s.desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase">Healing Strategies</h3>
            <div className="space-y-3">
              <div className="border-l-2 border-amber-300 pl-3">
                <p className="text-xs font-medium text-gray-700">Attempt 1: Reword</p>
                <p className="text-xs text-gray-500">Add failure context, ask agent to retry with awareness</p>
              </div>
              <div className="border-l-2 border-orange-300 pl-3">
                <p className="text-xs font-medium text-gray-700">Attempt 2: Rethink</p>
                <p className="text-xs text-gray-500">Complete strategy change, fresh approach</p>
              </div>
              <div className="border-l-2 border-red-300 pl-3">
                <p className="text-xs font-medium text-gray-700">Fallback: Manual Mode</p>
                <p className="text-xs text-gray-500">After 2 failed fixes, developer takes control</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trace visibility note */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 text-indigo-600" />
          <h3 className="text-sm font-semibold text-indigo-900">SigNoz Integration</h3>
        </div>
        <p className="text-sm text-indigo-800">
          When connected to SigNoz via OpenTelemetry, every agent step emits a trace span with token counts,
          latency, model name, and the Reviewer's semantic_score. The Copilot's healing decisions appear as
          span events in the trace waterfall — making the entire self-healing process visible and explainable.
        </p>
      </div>
    </div>
  )
}
