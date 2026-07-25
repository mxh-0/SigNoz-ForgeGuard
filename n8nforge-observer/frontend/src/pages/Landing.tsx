import { Link } from 'react-router-dom'
import {
  Zap, ArrowRight, ShieldCheck, Activity, Cpu, Eye, GitBranch, Gauge, Github,
} from 'lucide-react'

const AGENTS = [
  { name: 'Coordinator', role: 'Breaks the task into a research → build → review plan.' },
  { name: 'Researcher', role: 'Gathers the facts and constraints the build step needs.' },
  { name: 'Coder', role: 'Produces the actual deliverable, not a description of one.' },
  { name: 'Reviewer', role: 'Scores the result against a 5-dimension quality rubric.' },
]

const DETECTORS = [
  'Placeholder or filler text',
  'Answers that describe instead of solve',
  'Mostly-prose "code" output',
  'Repeated output across retries',
  'Off-topic or incomplete answers',
  'Reviewer critique despite a passing score',
]

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm font-bold text-gray-900">SignozForge Observer</span>
          </div>
          <nav className="flex items-center gap-1">
            <a
              href="#how"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition hover:text-gray-900 sm:block"
            >
              How it works
            </a>
            <a
              href="#observability"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition hover:text-gray-900 sm:block"
            >
              Observability
            </a>
            <Link
              to="/dashboard"
              className="ml-2 flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
            >
              Open app <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.55]"
          style={{
            backgroundImage:
              'radial-gradient(60% 55% at 50% 0%, rgb(224 231 255) 0%, rgba(255,255,255,0) 70%)',
          }}
        />
        <div className="mx-auto max-w-4xl px-6 pb-20 pt-20 text-center sm:pt-28">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3.5 py-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-indigo-600" />
            <span className="text-xs font-medium text-indigo-700">
              Self-healing agents, observable end to end
            </span>
          </div>

          <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-gray-900 sm:text-6xl">
            AI agents that catch
            <br />
            <span className="text-indigo-600">their own bad output</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-gray-600 sm:text-lg">
            Four agents plan, research, build, and review your task. An SRE Copilot watches every step,
            detects weak or generic results, and repairs them automatically. If it can't, it hands you the
            controls instead of shipping something useless.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/new"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 sm:w-auto"
            >
              <Zap className="h-4 w-4" /> Run your first task
            </Link>
            <Link
              to="/dashboard"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-6 py-3.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 sm:w-auto"
            >
              <Activity className="h-4 w-4" /> View dashboard
            </Link>
          </div>

          <p className="mt-5 text-xs text-gray-400">
            No signup. Runs locally against your own Groq key.
          </p>
        </div>
      </section>

      {/* ── The problem ────────────────────────────────────────────────────── */}
      <section className="border-y border-gray-100 bg-gray-50/70">
        <div className="mx-auto grid max-w-5xl gap-6 px-6 py-16 md:grid-cols-2">
          <div className="rounded-2xl border border-red-100 bg-white p-6">
            <span className="text-[11px] font-bold uppercase tracking-wider text-red-500">
              Without the Copilot
            </span>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              An agent returns a confident wall of text: "you would need to gather the credentials, assuming
              the migration is broken, replace the column name with the actual value." It scores 0.82 and
              ships. You find out it's useless after you've read all of it.
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-white p-6">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">
              With the Copilot
            </span>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              The same output trips four detectors before you ever see it. The Copilot rewrites the brief,
              reruns the step, and either delivers something real or tells you plainly that it needs your
              input. No silent failures.
            </p>
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────────── */}
      <section id="how" className="mx-auto max-w-5xl px-6 py-20">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            Four agents, one supervisor
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-gray-600">
            Each stage hands off to the next. The Copilot sits above all of them and can send any stage back
            to work.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {AGENTS.map((a, i) => (
            <div
              key={a.name}
              className="group relative rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-indigo-200 hover:shadow-sm"
            >
              <span className="font-mono text-[11px] font-bold text-indigo-400">0{i + 1}</span>
              <h3 className="mt-2 text-sm font-bold text-gray-900">{a.name}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{a.role}</p>
            </div>
          ))}
        </div>

        {/* Healing flow */}
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6">
          <div className="mb-5 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-gray-900">The healing path</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { n: '1', t: 'Reword', d: 'Adds the specific failure back into the brief and retries the step.' },
              { n: '2', t: 'Rethink', d: 'Forces a completely different approach on the second attempt.' },
              { n: '3', t: 'Manual Mode', d: 'Two strikes and it stops, handing you the partial result and the reason.' },
            ].map((s, i) => (
              <div
                key={s.t}
                className={`rounded-xl border-l-[3px] bg-gray-50/70 p-4 ${
                  i === 0 ? 'border-amber-300' : i === 1 ? 'border-orange-400' : 'border-red-400'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-bold text-gray-400">{s.n}</span>
                  <span className="text-xs font-bold text-gray-900">{s.t}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{s.d}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Detectors */}
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6">
          <div className="mb-4 flex items-center gap-2">
            <Eye className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-gray-900">What gets caught</h3>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {DETECTORS.map((d) => (
              <div key={d} className="flex items-start gap-2 rounded-lg bg-gray-50/70 px-3 py-2.5">
                <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-indigo-400" />
                <span className="text-xs leading-relaxed text-gray-700">{d}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Observability ──────────────────────────────────────────────────── */}
      <section id="observability" className="border-t border-gray-100 bg-gray-50/70">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="mb-12 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
              Powered by SigNoz
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-gray-600">
              Telemetry isn't a side channel here. The Copilot reads its own traces and metrics back out of
              SigNoz and uses them to decide how hard to retry.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                icon: GitBranch,
                title: 'Every step traced',
                body: 'Agent spans, Copilot decisions, and each LLM call with tokens, latency, and model.',
              },
              {
                icon: Gauge,
                title: 'Custom metrics',
                body: 'Anomaly counts by type, healing attempts vs successes, manual-mode rate, LLM error breakdown.',
              },
              {
                icon: Cpu,
                title: 'Feedback loop',
                body: 'Degraded LLM latency or a low historical fix rate changes how the Copilot writes its next brief.',
              },
            ].map((f) => (
              <div key={f.title} className="rounded-2xl border border-gray-200 bg-white p-6">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50">
                  <f.icon className="h-4 w-4 text-indigo-600" />
                </div>
                <h3 className="text-sm font-bold text-gray-900">{f.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{f.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6">
            <h3 className="mb-4 text-sm font-bold text-gray-900">Also worth knowing</h3>
            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {[
                ['RAM-only context', 'Task state lives in memory. No database, no cross-session memory.'],
                ['Streaming progress', 'Server-sent events push each stage to the UI as it happens.'],
                ['Stop any time', 'End a running task from the UI and the pipeline halts cleanly.'],
                ['Iterate on results', 'Send a follow-up and the next run gets the previous output as context.'],
              ].map(([t, d]) => (
                <div key={t} className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-gray-300" />
                  <p className="text-xs leading-relaxed text-gray-600">
                    <span className="font-semibold text-gray-900">{t}.</span> {d}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
          Give it something hard
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-gray-600">
          Try a vague or under-specified task and watch the Copilot refuse to let a hand-wavy answer through.
        </p>
        <Link
          to="/new"
          className="mt-8 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
        >
          <Zap className="h-4 w-4" /> Run a task
        </Link>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-indigo-600" />
            <span className="text-xs text-gray-500">SignozForge Observer — SRE Copilot v2.0</span>
          </div>
          <div className="flex items-center gap-5 text-xs text-gray-400">
            <a
              href="http://localhost:3301"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-gray-700"
            >
              SigNoz
            </a>
            <a
              href="https://github.com/signoz/signoz"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 transition hover:text-gray-700"
            >
              <Github className="h-3.5 w-3.5" /> GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
