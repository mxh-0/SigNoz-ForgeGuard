# n8nForge Observer — Self-Healing Multi-Agent System with SigNoz Observability

A multi-agent AI pipeline supervised by an SRE Copilot that detects bad output, heals failures automatically, and uses SigNoz as its observability backbone — both for exporting telemetry and reading it back to make smarter decisions.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [How SigNoz Is Used](#how-signoz-is-used)
4. [Features](#features)
5. [Tech Stack](#tech-stack)
6. [Quick Start](#quick-start)
7. [Project Structure](#project-structure)
8. [API Reference](#api-reference)
9. [Anomaly Detection](#anomaly-detection)
10. [The Healing Path](#the-healing-path)
11. [Custom Metrics and Traces](#custom-metrics-and-traces)
12. [Frontend](#frontend)
13. [Configuration](#configuration)
14. [Reproducibility (Docker)](#reproducibility-docker)
15. [Demo Scenarios](#demo-scenarios)

---

## Overview

n8nForge Observer solves a real problem with AI agents: **they produce confident-sounding garbage and nobody catches it before it ships.**

A typical agent pipeline scores its own output 0.82/1.0 and calls it "passing" even when the reviewer's own reasoning says "lacks specific details and isn't fully useful." The developer discovers the output is useless only after reading the entire thing.

This project adds an SRE Copilot layer that:
- Watches every agent step with 7 independent anomaly detectors
- Catches placeholder text, hedging language, off-topic answers, loop patterns, and weak scores
- Repairs failures automatically (2-strike rule: reword, rethink, then manual mode)
- Uses SigNoz traces and metrics to inform its retry strategy based on historical performance
- Never ships silently broken output — it either fixes it or tells you plainly that it needs your help

---

## Architecture

```
                        Developer
                           |
                           v
                    +--------------+
                    |   Frontend   |  React + Vite + Tailwind
                    |  (Vercel)    |  Landing, Dashboard, TaskView, Observability
                    +--------------+
                           |
                           | HTTP + SSE
                           v
                    +--------------+
                    |   Backend    |  FastAPI (Python)
                    |   :8000      |
                    +--------------+
                           |
              +------------+------------+
              |            |            |
              v            v            v
        +---------+  +---------+  +---------+
        |Coordin- |  |Research-|  |  Coder  |---> Reviewer
        |  ator   |  |   er    |  |         |       |
        +---------+  +---------+  +---------+       |
                                                     |
              +--------------------------------------+
              |
              v
        +------------------+
        |   SRE Copilot    |  Anomaly detection + healing
        |                  |  Queries SigNoz for context
        +------------------+
              |
              | OTLP (traces + metrics)        | HTTP Query API
              v                                v
        +------------------------------------------+
        |              SigNoz                       |
        |  ClickHouse + OTel Collector + UI         |
        |  :4318 (ingest)  :3301 (dashboard)        |
        +------------------------------------------+
```

**Data flow:**
1. Developer submits a task via the frontend
2. Backend runs the 4-agent pipeline (Coordinator → Researcher → Coder → Reviewer)
3. After each step, the SRE Copilot evaluates the output
4. If an anomaly is detected, the Copilot queries SigNoz for historical context, then retries with a targeted fix hint
5. All spans and metrics are exported to SigNoz in real-time
6. The frontend receives live SSE events showing progress, anomalies, and healing attempts

---

## How SigNoz Is Used

SigNoz is not a passive log drain in this project. It is the Copilot's **observability backbone** with a bidirectional integration:

### What We Export TO SigNoz

| Span / Metric | Description |
|---|---|
| `agent.coordinator` | Task decomposition trace |
| `agent.researcher` | Research step with token count, latency |
| `agent.coder` | Code generation with output length |
| `agent.reviewer` | Review with semantic_score attribute |
| `copilot.evaluate` | Every anomaly detection decision |
| `copilot.heal` | Healing attempts with strategy and outcome |
| `llm.call` | Every LLM API call with model, tokens, latency, caller agent |
| `n8nforge.tasks.submitted` | Counter: tasks submitted |
| `n8nforge.tasks.completed` | Counter: successful completions |
| `n8nforge.tasks.failed` | Counter: errors + manual mode |
| `n8nforge.copilot.anomalies_detected` | Counter by anomaly type |
| `n8nforge.copilot.healing_attempts` | Counter by strategy |
| `n8nforge.copilot.healing_successes` | Counter: fixes that worked |
| `n8nforge.copilot.manual_mode_triggers` | Counter: escalations |
| `n8nforge.llm.calls_total` | Counter by model and calling agent |
| `n8nforge.llm.errors_total` | Counter by error type (timeout/rate_limit/http) |
| `n8nforge.llm.latency_ms` | Histogram: LLM call latency distribution |
| `n8nforge.agent.step_latency_ms` | Histogram: agent step duration |

### What We READ FROM SigNoz

The Copilot queries SigNoz Query Service API before making healing decisions:

| Query | Purpose |
|---|---|
| Step health (avg latency, error rate) | Detect degraded agent steps |
| LLM health (p95 latency, rate limit hits) | Adjust retry strategy when LLM is slow |
| Healing history (success rate) | If historical fix rate is low, warn the agent this is its last chance |
| Recent error traces | Feed previous failure context into the fix prompt |

**This feedback loop means the Copilot gets smarter over time** — it doesn't just detect problems, it adapts its response based on what has worked before.

### Pre-Built Dashboard

A ready-to-import SigNoz dashboard JSON (`signoz/dashboard-n8nforge-observer.json`) ships with the project containing 11 panels:
- Task funnel (submitted / completed / failed / anomalies)
- LLM latency (avg + p95)
- Healing attempts vs successes
- Manual mode rate
- Agent step latency from traces
- LLM calls by agent
- LLM errors by type

---

## Features

- **Multi-agent pipeline**: Coordinator (planning) → Researcher (context) → Coder (output) → Reviewer (scoring)
- **SRE Copilot with 7 anomaly detectors**: catches what other systems miss
- **2-strike healing**: reword → rethink → manual mode (never infinite loops)
- **Bidirectional SigNoz integration**: export traces/metrics AND read them back for decisions
- **SSE live streaming**: frontend shows each step as it happens
- **Follow-up composer**: iterate on results without starting over (chat-style refinement)
- **Task cancellation**: end any running task from the UI
- **RAM-only context**: no database, no cross-session memory, ephemeral per-task
- **Rate-limit aware LLM client**: tracks token budget, exponential backoff with jitter
- **Landing page**: explains the product for new users
- **Observability dashboard**: shows live SigNoz connection status and metrics in the app

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11+, FastAPI, Pydantic |
| LLM | Groq (llama-3.3-70b-versatile), OpenAI-compatible API |
| Telemetry | OpenTelemetry SDK, OTLP HTTP exporter |
| Observability | SigNoz (standalone Docker image) |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Streaming | Server-Sent Events (sse-starlette) |
| State | In-memory (RAM), no database |
| Deployment | Vercel (frontend), local/Docker (backend + SigNoz) |

---

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- Docker Desktop (for SigNoz)
- Groq API key (free at https://console.groq.com)

### Step 1: Start SigNoz

```bash
docker run -d --name signoz --privileged \
  -p 3301:8080 \
  -p 4317:4317 \
  -p 4318:4318 \
  -v signoz-clickhouse:/var/lib/clickhouse \
  -v signoz-data:/var/lib/signoz \
  signoz/signoz-standalone:latest
```

Wait ~60 seconds for it to initialize. Verify:
```bash
curl http://localhost:4318/v1/traces -X POST -d '{}' -H "Content-Type: application/json"
# Should return: {"partialSuccess":{}}
```

SigNoz UI: http://localhost:3301

### Step 2: Start the Backend

```bash
cd n8nforge-observer

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and add your LLM_API_KEY (Groq key)

# Start the server
python -m uvicorn backend.main:app --reload --port 8000
```

You should see:
```
[SigNoz] Telemetry active -- traces + metrics --> http://localhost:4318
```

### Step 3: Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

### Step 4: Submit a Task

1. Go to "New Task"
2. Type a prompt or click an example
3. Watch the pipeline execute in real-time
4. Check SigNoz at http://localhost:3301 → Services → `n8nforge-observer`

---

## Project Structure

```
n8nforge-observer/
├── backend/
│   ├── main.py                 # FastAPI app, endpoints, pipeline orchestration
│   ├── config.py               # Settings (Groq, SigNoz, thresholds)
│   ├── llm.py                  # Async LLM client with tracing + rate limits
│   ├── context_store.py        # RAM-only task state (no database)
│   ├── copilot.py              # SRE Copilot: anomaly detection + healing
│   ├── signoz_client.py        # Queries SigNoz for historical data
│   ├── instrumentation.py      # OpenTelemetry setup: spans, metrics, helpers
│   └── agents/
│       ├── coordinator.py      # Task decomposition
│       ├── researcher.py       # Information gathering
│       ├── coder.py            # Artifact production
│       └── reviewer.py         # LLM-as-Judge quality scoring
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Landing.tsx     # Marketing/landing page
│       │   ├── Dashboard.tsx   # System health + recent tasks
│       │   ├── NewTask.tsx     # Task submission + examples
│       │   ├── TaskView.tsx    # Live pipeline, output, follow-ups
│       │   ├── Analytics.tsx   # SigNoz metrics + observability status
│       │   └── ContextInspector.tsx  # RAM context viewer
│       ├── components/
│       │   ├── Markdown.tsx    # Rich markdown renderer with code blocks
│       │   └── FollowUpComposer.tsx  # Chat-style refinement UI
│       └── lib/
│           ├── api.ts          # Backend API client
│           └── thread.ts       # Client-side conversation threading
├── signoz/
│   └── dashboard-n8nforge-observer.json  # Pre-built SigNoz dashboard
├── docker-compose.yml          # Full stack deployment
├── Dockerfile.backend          # Backend container
├── Dockerfile.frontend         # Frontend container (multi-stage with nginx)
├── nginx.conf                  # Production frontend proxy config
├── requirements.txt            # Python dependencies
└── .env.example                # Environment template
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/tasks` | Submit a new task. Returns `task_id` immediately. |
| `GET` | `/tasks/{id}` | Get full task result (poll until status != "running") |
| `GET` | `/tasks/{id}/stream` | SSE stream of live progress events |
| `POST` | `/tasks/{id}/cancel` | Cancel/end a running task |
| `GET` | `/context` | List all active task IDs |
| `GET` | `/context/{id}` | View RAM context snapshot for a task |
| `GET` | `/signoz/health` | Check SigNoz connectivity |
| `GET` | `/signoz/metrics` | Get aggregated metrics from SigNoz |
| `GET` | `/health` | Backend healthcheck |

### Task Response Schema

```json
{
  "task_id": "task_abc123",
  "status": "success | running | manual_mode | error | cancelled",
  "prompt": "...",
  "steps": [
    { "name": "research", "agent": "Researcher", "status": "done", "output": "...", "tokens": 346, "latency_ms": 1224 }
  ],
  "final_output": "...",
  "total_tokens": 1926,
  "retry_count": 1,
  "anomalies": [
    { "step": "code", "kind": "vague_answer", "detail": "...", "timestamp": "..." }
  ],
  "fix_history": [
    { "attempt": 1, "strategy": "reword", "action": "...", "result": "success", "timestamp": "..." }
  ],
  "mode": "automatic | manual",
  "error": ""
}
```

---

## Anomaly Detection

The SRE Copilot runs 7 independent detectors after every agent step:

| # | Detector | What It Catches |
|---|---|---|
| 1 | Agent error | Exceptions thrown during step execution |
| 2 | Score floor (0.88) | Reviewer scores below the strict quality bar |
| 3 | Reviewer critique parsing | High score but negative reasoning ("lacks", "incomplete", "generic") |
| 4 | Placeholder/filler detection | 25+ known phrases: "here is a solution", "as an AI model", "todo:", "your code here" |
| 5 | Hedging/vagueness markers | "you would need to", "assuming the", "requires further investigation", "contact the administrator" |
| 6 | Code quality (code step only) | Tiny code blocks (<80 chars), unclosed fences, mostly-prose (<15% code ratio), no code at all |
| 7 | Loop detection | Jaccard similarity >= 0.80 against all previous outputs of the same step |
| 8 | Off-topic detection | Keyword overlap with prompt below threshold (35% for short, 20% for long output) |

Each detection is logged visually in the backend terminal:
```
======================================================================
  [ANOMALY DETECTED]  [14:23:45]
  Step: code
  Issue: Output in 'code' describes a process instead of solving the task
         (4 hedging markers: ['can be obtained by', 'contacting the database administrator', 'assuming the'])
======================================================================
```

---

## The Healing Path

```
Step fails anomaly check
        │
        ▼
┌─── Strike 1: REWORD ───┐
│  Adds the specific      │
│  failure back into the  │
│  brief. Asks the agent  │
│  to be more thorough.   │
└─────────┬───────────────┘
          │ still fails?
          ▼
┌─── Strike 2: RETHINK ──┐
│  Forces a completely    │
│  different approach.    │
│  "Start fresh, use      │
│  alternative strategy." │
└─────────┬───────────────┘
          │ still fails?
          ▼
┌─── MANUAL MODE ─────────┐
│  Stops. Hands partial   │
│  output + reason to the │
│  developer. No infinite │
│  loops, no silent fail. │
└──────────────────────────┘
```

The Copilot also queries SigNoz before deciding:
- If the LLM is currently degraded (high latency), the retry hint asks for conciseness
- If historical healing success rate is low, it warns the agent "this is your last chance"
- If a specific step has been failing frequently, it adds that context to the fix prompt

---

## Custom Metrics and Traces

### Traces visible in SigNoz

Navigate to SigNoz → Traces → filter by `serviceName = n8nforge-observer`:

- **`agent.coordinator`** — with attributes: `task.id`, `task.prompt_short`
- **`agent.researcher`** — with: `agent.tokens`, latency
- **`agent.coder`** — with: `agent.tokens`, output characteristics
- **`agent.reviewer`** — with: `copilot.score`
- **`copilot.evaluate`** — with: `copilot.decision` (continue/retry/manual), `copilot.anomaly_type`, `copilot.strategy`, `copilot.signoz_context`
- **`llm.call`** — with: `llm.model`, `llm.tokens_total`, `llm.tokens_prompt`, `llm.tokens_completion`, `llm.latency_ms`, `llm.caller_agent`, `llm.attempts`, `llm.rate_limited`

### Metrics visible in SigNoz Metrics Explorer

| Metric | Type | Labels |
|---|---|---|
| `n8nforge_tasks_submitted_total` | Counter | — |
| `n8nforge_tasks_completed_total` | Counter | — |
| `n8nforge_tasks_failed_total` | Counter | — |
| `n8nforge_copilot_anomalies_detected_total` | Counter | `anomaly.type`, `agent.step` |
| `n8nforge_copilot_healing_attempts_total` | Counter | `copilot.strategy`, `agent.step`, `copilot.attempt` |
| `n8nforge_copilot_healing_successes_total` | Counter | `agent.step` |
| `n8nforge_copilot_manual_mode_triggers_total` | Counter | `task.id` |
| `n8nforge_llm_calls_total_total` | Counter | `llm.model`, `llm.caller` |
| `n8nforge_llm_errors_total_total` | Counter | `llm.error_type`, `llm.model` |
| `n8nforge_llm_latency_ms` | Histogram | `llm.model`, `llm.caller` |
| `n8nforge_agent_step_latency_ms` | Histogram | — |

---

## Frontend

| Page | Route | Description |
|---|---|---|
| Landing | `/` | Product overview, explains the Copilot and SigNoz integration |
| Dashboard | `/dashboard` | System health, active tasks, recent history |
| New Task | `/new` | Submit tasks, example prompts, Copilot stress tests |
| Task View | `/task/:id` | Live pipeline stepper, rendered output, anomaly/healing cards, follow-up composer |
| Observability | `/analytics` | Live SigNoz metrics, connection status, exported spans/metrics reference |
| Context | `/context` | RAM context inspector |

### Key UX features:
- Markdown output rendering with syntax-highlighted code blocks and copy buttons
- Pipeline stepper showing which stage is active
- Anomaly cards (red) and healing cards (amber) appear live as SSE events arrive
- Follow-up composer with quick-action chips ("Add code examples", "Make it more concise", etc.)
- Thread breadcrumbs for revision chains (Original → Revision 1 → Revision 2)
- Download output as `.md` file
- Quality badge from reviewer score in the task header

---

## Configuration

Environment variables (`.env`):

| Variable | Required | Default | Description |
|---|---|---|---|
| `LLM_API_KEY` | Yes | — | Groq API key |
| `LLM_BASE_URL` | No | `https://api.groq.com/openai/v1` | LLM endpoint |
| `LLM_MODEL` | No | `llama-3.3-70b-versatile` | Model |
| `LLM_TEMPERATURE` | No | `0.2` | Temperature |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | `http://localhost:4318` | OTel collector |
| `SIGNOZ_QUERY_URL` | No | `http://localhost:3301` | SigNoz Query Service |
| `SERVICE_NAME` | No | `n8nforge-observer` | OTel service name |
| `MAX_AUTO_FIX_ATTEMPTS` | No | `2` | Healing strikes before manual mode |
| `SEMANTIC_SCORE_THRESHOLD` | No | `0.6` | Reviewer pass mark |

---

## Reproducibility (Docker)

Two commands to reproduce the full stack locally:

### Command 1: Start SigNoz

```bash
docker run -d --name signoz --privileged \
  -p 3301:8080 -p 4317:4317 -p 4318:4318 \
  -v signoz-clickhouse:/var/lib/clickhouse \
  -v signoz-data:/var/lib/signoz \
  signoz/signoz-standalone:latest
```

### Command 2: Start the application

```bash
docker compose up -d --build
```

This builds and starts:
- `n8nforge-backend` on port 8000 (connects to SigNoz for telemetry)
- `n8nforge-frontend` on port 5173 (nginx serving the built React app)

### Access points:
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- SigNoz Dashboard: http://localhost:3301

### Requirements:
- Docker Desktop with at least 6 GB RAM allocated
- A valid `LLM_API_KEY` in `.env`
- Internet access (for Groq API calls)

---

## Demo Scenarios

### Scenario 1: Clean pass (no anomaly)

**Prompt:** "Write a Python function that reverses a string"

**Expected behavior:**
- All 4 steps complete successfully
- Backend logs: `[COPILOT] No anomaly in 'research' -- continuing`, etc.
- Frontend: green checkmarks on all pipeline stages
- SigNoz: clean trace waterfall with all spans succeeding

### Scenario 2: Copilot catches and heals (recommended for demo)

**Prompt:** "Connect to my local PostgreSQL database at 192.168.1.50 and fix the broken migration in table users_v3"

**Expected behavior:**
- Coder produces hedging text ("you would need to determine...", "contact the administrator...")
- Copilot detects `vague_answer` anomaly
- Backend logs show the `[ANOMALY DETECTED]` and `[COPILOT HEALING]` banners
- Frontend shows red anomaly card and amber healing card in real-time
- After 2 failed attempts: switches to Manual Mode
- SigNoz: `copilot.evaluate` spans show `anomaly_type = vague_answer`, `decision = retry`

### Scenario 3: Follow-up refinement

1. Submit "Explain REST vs GraphQL"
2. After completion, use the follow-up composer: "Add a comparison table"
3. A new task runs with the previous output as context
4. Thread breadcrumb shows "Original → Revision 1"

---

## License

MIT

---

## Team

Built for the SigNoz Hackathon 2025.
