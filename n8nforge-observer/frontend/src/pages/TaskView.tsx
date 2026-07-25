import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Copy, Check, Download, XCircle, Shield, ShieldAlert, StopCircle,
  Wrench, ChevronDown, ChevronRight, Loader2, CheckCircle2, CircleDot,
} from 'lucide-react'
import { getTask, subscribeToTask, cancelTask, type TaskResult } from '../lib/api'
import { getAncestry, getNode, recordTask } from '../lib/thread'
import Markdown from '../components/Markdown'
import FollowUpComposer from '../components/FollowUpComposer'

type Ev = { step: string; status: string; message: string }

const PIPELINE = ['coordinator', 'research', 'code', 'review'] as const

export default function TaskView() {
  const { taskId } = useParams<{ taskId: string }>()
  const [task, setTask] = useState<TaskResult | null>(null)
  const [events, setEvents] = useState<Ev[]>([])
  const [copied, setCopied] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [openSteps, setOpenSteps] = useState<Record<string, boolean>>({})
  const [showTimeline, setShowTimeline] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!taskId) return
    setTask(null)
    setEvents([])

    const close = subscribeToTask(taskId, (ev, data) => {
      if (ev === 'status') setEvents((prev) => [...prev, data])
      if (ev === 'complete' || ev === 'error') {
        getTask(taskId).then(setTask).catch(() => {})
      }
    })

    const poll = setInterval(() => {
      getTask(taskId)
        .then((t) => {
          setTask(t)
          if (t.status !== 'running') clearInterval(poll)
        })
        .catch(() => {})
    }, 3000)

    return () => {
      close()
      clearInterval(poll)
    }
  }, [taskId])

  // Make sure the root task is in the local thread history.
  useEffect(() => {
    if (!taskId || !task?.prompt) return
    if (!getNode(taskId)) recordTask({ taskId, prompt: task.prompt, parentId: null })
  }, [taskId, task?.prompt])

  // Keep the live log scrolled to the newest event.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [events.length])

  const isRunning = !task || task.status === 'running'
  const isSuccess = task?.status === 'success'
  const isManual = task?.status === 'manual_mode'
  const isError = task?.status === 'error'
  const isCancelled = task?.status === 'cancelled'

  const ancestry = useMemo(() => (taskId ? getAncestry(taskId) : []), [taskId, task?.status])
  const thisNode = taskId ? getNode(taskId) : null

  const reviewScore = useMemo(() => {
    const review = task?.steps.find((s) => s.name === 'review')
    const m = review?.output.match(/Score:\s*([\d.]+)/)
    return m ? parseFloat(m[1]) : null
  }, [task?.steps])

  const copyOutput = () => {
    if (!task?.final_output) return
    navigator.clipboard.writeText(task.final_output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadOutput = () => {
    if (!task?.final_output) return
    const blob = new Blob([task.final_output], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${taskId}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCancel = async () => {
    if (!taskId) return
    setCancelling(true)
    try {
      await cancelTask(taskId)
      setTask((prev) => (prev ? { ...prev, status: 'cancelled' } : null))
    } catch {
      /* keep the UI responsive either way */
    }
    setCancelling(false)
  }

  // Which pipeline stage is currently active, for the stepper.
  const stageState = (stage: string): 'done' | 'active' | 'pending' => {
    const step = task?.steps.find((s) => s.name === stage)
    if (step?.status === 'done') return 'done'
    if (step?.status === 'running') return 'active'
    if (stage === 'coordinator' && (task?.steps.length ?? 0) > 0) return 'done'
    const evs = events.filter((e) => e.step === stage)
    if (evs.some((e) => e.status === 'done')) return 'done'
    if (evs.some((e) => e.status === 'running')) return 'active'
    return 'pending'
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-8">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-4">
        <Link
          to="/dashboard"
          aria-label="Back to dashboard"
          className="mt-0.5 rounded-lg p-2 transition hover:bg-gray-100"
        >
          <ArrowLeft className="h-4 w-4 text-gray-500" />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-lg font-bold text-gray-900">Task</h1>
            <code className="rounded bg-gray-100 px-2 py-1 font-mono text-[11px] text-gray-500">{taskId}</code>
            <StatusPill
              running={isRunning}
              success={isSuccess}
              manual={isManual}
              error={isError}
              cancelled={isCancelled}
            />
            {reviewScore !== null && (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  reviewScore >= 0.88
                    ? 'bg-emerald-50 text-emerald-700'
                    : reviewScore >= 0.6
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-red-50 text-red-700'
                }`}
              >
                Quality {(reviewScore * 100).toFixed(0)}%
              </span>
            )}
          </div>

          {task && <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{task.prompt}</p>}

          {thisNode?.followUp && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-indigo-600">
              <Wrench className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span>Revision: {thisNode.followUp}</span>
            </p>
          )}
        </div>

        {isRunning && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          >
            <StopCircle className="h-3.5 w-3.5" />
            {cancelling ? 'Ending...' : 'End Task'}
          </button>
        )}
      </div>

      {/* ── Thread breadcrumb (only when this task is part of a chain) ─────── */}
      {ancestry.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs">
          <span className="font-semibold uppercase tracking-wider text-gray-400">Thread</span>
          {ancestry.map((node, i) => (
            <span key={node.taskId} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3 w-3 text-gray-300" />}
              {node.taskId === taskId ? (
                <span className="rounded bg-indigo-50 px-2 py-1 font-medium text-indigo-700">
                  {i === 0 ? 'Original' : `Revision ${i}`}
                </span>
              ) : (
                <Link
                  to={`/task/${node.taskId}`}
                  className="rounded px-2 py-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
                >
                  {i === 0 ? 'Original' : `Revision ${i}`}
                </Link>
              )}
            </span>
          ))}
        </div>
      )}

      {/* ── Pipeline stepper ───────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          {PIPELINE.map((stage, i) => {
            const state = stageState(stage)
            return (
              <div key={stage} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full border-2 transition ${
                      state === 'done'
                        ? 'border-emerald-500 bg-emerald-500'
                        : state === 'active'
                          ? 'border-indigo-500 bg-white'
                          : 'border-gray-200 bg-white'
                    }`}
                  >
                    {state === 'done' ? (
                      <Check className="h-3.5 w-3.5 text-white" />
                    ) : state === 'active' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />
                    ) : (
                      <CircleDot className="h-3 w-3 text-gray-300" />
                    )}
                  </div>
                  <span
                    className={`text-[11px] font-medium capitalize ${
                      state === 'pending' ? 'text-gray-400' : 'text-gray-700'
                    }`}
                  >
                    {stage}
                  </span>
                </div>
                {i < PIPELINE.length - 1 && (
                  <div
                    className={`mx-2 mb-5 h-0.5 flex-1 rounded transition ${
                      state === 'done' ? 'bg-emerald-400' : 'bg-gray-150 bg-gray-100'
                    }`}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Anomalies ──────────────────────────────────────────────────────── */}
      {task && task.anomalies?.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-600" />
            <h3 className="text-sm font-semibold text-red-900">
              Anomalies Detected ({task.anomalies.length})
            </h3>
          </div>
          <div className="space-y-2.5">
            {task.anomalies.map((a, i) => (
              <div key={i} className="flex items-start gap-3">
                <code className="mt-0.5 flex-shrink-0 rounded bg-red-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-red-700">
                  {a.kind}
                </code>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-red-800">step: {a.step}</p>
                  <p className="mt-0.5 break-words text-xs leading-relaxed text-red-700">{a.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3.5 border-t border-red-200 pt-3 text-xs text-red-600">
            The SRE Copilot caught these and triggered the healing path.
          </p>
        </div>
      )}

      {/* ── Copilot interventions ──────────────────────────────────────────── */}
      {task && task.fix_history.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-amber-900">
              SRE Copilot Interventions ({task.fix_history.length})
            </h3>
          </div>
          <div className="space-y-2.5">
            {task.fix_history.map((fix) => (
              <div key={fix.attempt} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                    fix.result === 'success'
                      ? 'bg-emerald-100 text-emerald-700'
                      : fix.result === 'fail'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {fix.result}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-amber-900">
                    Attempt {fix.attempt} — {fix.strategy}
                  </p>
                  <p className="mt-0.5 break-words text-xs leading-relaxed text-amber-700">{fix.action}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Manual mode notice ─────────────────────────────────────────────── */}
      {isManual && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5">
          <h3 className="mb-1 text-sm font-semibold text-orange-900">Manual Mode — your turn</h3>
          <p className="text-xs leading-relaxed text-orange-800">
            The Copilot used both auto-fix attempts and the result still did not meet the bar. The partial
            output is below. Use the refine box to steer it, or start a new task with a tighter brief.
          </p>
        </div>
      )}

      {/* ── Output ─────────────────────────────────────────────────────────── */}
      {task?.final_output ? (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Output</span>
              {task.total_tokens > 0 && (
                <span className="text-[11px] text-gray-400">{task.total_tokens.toLocaleString()} tokens</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="rounded px-2 py-1 text-xs font-medium text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
              >
                {showRaw ? 'Rendered' : 'Raw'}
              </button>
              <button
                onClick={downloadOutput}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
              >
                <Download className="h-3 w-3" /> .md
              </button>
              <button
                onClick={copyOutput}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div className="px-6 py-5">
            {showRaw ? (
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-600">
                {task.final_output}
              </pre>
            ) : (
              <Markdown content={task.final_output} />
            )}
          </div>
        </div>
      ) : (
        isRunning && (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-14 text-center">
            <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin text-indigo-500" />
            <p className="text-sm font-medium text-gray-700">Agents are working on it</p>
            <p className="mt-1 text-xs text-gray-500">
              {events.length > 0 ? events[events.length - 1].message : 'Starting the pipeline...'}
            </p>
          </div>
        )
      )}

      {/* ── Follow-up composer ─────────────────────────────────────────────── */}
      {task && taskId && task.final_output && (
        <FollowUpComposer
          taskId={taskId}
          originalPrompt={task.prompt}
          previousOutput={task.final_output}
          disabled={isRunning}
        />
      )}

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {task?.error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <div className="mb-2 flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-500" />
            <span className="text-sm font-semibold text-red-800">Error</span>
          </div>
          <pre className="whitespace-pre-wrap font-mono text-xs text-red-700">{task.error}</pre>
        </div>
      )}

      {/* ── Live activity log (collapsible) ────────────────────────────────── */}
      {events.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white">
          <button
            onClick={() => setShowTimeline((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-3 text-left"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Activity Log ({events.length})
            </span>
            <ChevronDown
              className={`h-4 w-4 text-gray-400 transition-transform ${showTimeline ? 'rotate-180' : ''}`}
            />
          </button>
          {showTimeline && (
            <div ref={logRef} className="max-h-72 space-y-2 overflow-y-auto border-t border-gray-100 p-4">
              {events.map((ev, i) => {
                if (ev.status === 'anomaly') {
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5"
                    >
                      <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
                      <div className="min-w-0">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-red-800">
                          Anomaly Detected
                        </span>
                        <p className="mt-0.5 break-words text-xs leading-relaxed text-red-700">
                          {ev.message.replace('ANOMALY DETECTED — ', '')}
                        </p>
                      </div>
                    </div>
                  )
                }
                if (ev.status === 'healing') {
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
                    >
                      <Wrench className="mt-0.5 h-4 w-4 flex-shrink-0 animate-pulse text-amber-600" />
                      <div className="min-w-0">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-amber-800">
                          Copilot Healing
                        </span>
                        <p className="mt-0.5 break-words text-xs leading-relaxed text-amber-700">{ev.message}</p>
                      </div>
                    </div>
                  )
                }
                return (
                  <div key={i} className="flex items-center gap-3 px-1 text-sm">
                    <span
                      className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                        ev.status === 'done'
                          ? 'bg-emerald-500'
                          : ev.status === 'running'
                            ? 'animate-pulse bg-blue-500'
                            : ev.status === 'failed'
                              ? 'bg-red-500'
                              : 'bg-gray-300'
                      }`}
                    />
                    <span className="w-20 flex-shrink-0 text-xs font-medium capitalize text-gray-700">
                      {ev.step}
                    </span>
                    <span className="truncate text-xs text-gray-500">{ev.message}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Step details (collapsible per step) ────────────────────────────── */}
      {task && task.steps.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-5 py-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Agent Steps</span>
          </div>
          <div className="divide-y divide-gray-50">
            {task.steps.map((step) => {
              const open = openSteps[step.name]
              return (
                <div key={step.name}>
                  <button
                    onClick={() => setOpenSteps((p) => ({ ...p, [step.name]: !p[step.name] }))}
                    className="flex w-full items-center justify-between px-5 py-3.5 text-left transition hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-2.5">
                      <ChevronRight
                        className={`h-3.5 w-3.5 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
                      />
                      {step.status === 'done' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : step.status === 'failed' ? (
                        <XCircle className="h-3.5 w-3.5 text-red-500" />
                      ) : (
                        <CircleDot className="h-3.5 w-3.5 text-gray-300" />
                      )}
                      <span className="text-sm font-semibold capitalize text-gray-800">{step.name}</span>
                      <span className="text-xs text-gray-400">{step.agent}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-gray-400">
                      <span>{step.tokens} tokens</span>
                      <span>{step.latency_ms > 0 ? `${step.latency_ms.toFixed(0)}ms` : '—'}</span>
                    </div>
                  </button>
                  {open && step.output && (
                    <div className="border-t border-gray-50 bg-gray-50/60 px-5 py-4">
                      <Markdown content={step.output} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Footer stats ───────────────────────────────────────────────────── */}
      {task && task.status !== 'running' && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 pb-4 text-xs text-gray-500">
          <span>
            Tokens <strong className="text-gray-700">{task.total_tokens.toLocaleString()}</strong>
          </span>
          <span>
            Retries <strong className="text-gray-700">{task.retry_count}</strong>
          </span>
          <span>
            Anomalies <strong className="text-gray-700">{task.anomalies?.length ?? 0}</strong>
          </span>
          <span>
            Mode <strong className="text-gray-700">{task.mode}</strong>
          </span>
        </div>
      )}
    </div>
  )
}

function StatusPill({
  running, success, manual, error, cancelled,
}: {
  running: boolean; success: boolean; manual: boolean; error: boolean; cancelled: boolean
}) {
  if (running)
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" /> Running
      </span>
    )
  if (success)
    return (
      <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
        Complete
      </span>
    )
  if (manual)
    return (
      <span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-[11px] font-medium text-orange-700">
        Manual Mode
      </span>
    )
  if (error)
    return <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-medium text-red-700">Error</span>
  if (cancelled)
    return <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-600">Ended</span>
  return null
}
