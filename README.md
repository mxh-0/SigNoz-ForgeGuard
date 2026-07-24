# SigNoz ForgeGuard — n8nForge Observer

**Agents of SigNoz 2026 — Track 1: AI & Agent Observability**

A hybrid multi-agent system with full pipeline visibility and self-healing. Submit a task, watch four specialized agents execute it in sequence, and let the SRE Copilot detect failures and attempt automatic recovery before escalating to manual mode.

Built for the hackathon goal: make agent workflows **observable**, **recoverable**, and **explainable** — not a black box of blind retries.

---

## Table of Contents

- [Overview](#overview)
- [System Diagrams](#system-diagrams)
- [Architecture](#architecture)
- [Repository Structure](#repository-structure)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Agent Pipeline](#agent-pipeline)
- [SRE Copilot & Self-Healing](#sre-copilot--self-healing)
- [Frontend](#frontend)
- [Roadmap](#roadmap)
- [Documentation](#documentation)

---

## Overview

n8nForge Observer runs a four-agent pipeline on every task:

| Agent | Role |
|-------|------|
| **Coordinator** | Decomposes the user prompt into research → code → review steps |
| **Researcher** | Gathers relevant information for the task |
| **Coder** | Produces the final deliverable from research findings |
| **Reviewer** | LLM-as-Judge quality scoring (0.0–1.0 semantic score) |

The **SRE Copilot** watches each step for anomalies (errors, low quality scores, empty output) and applies a **2-strike automatic healing policy** before switching to **Manual Mode** for developer intervention.

All in-flight task state lives in an **in-memory RAM context store** — fast, ephemeral, and keyed by `task_id`. No database.

---

## System Diagrams

### High-Level Architecture

Five layers from user intake to observability. Solid lines are implemented today; dashed lines are on the roadmap.

```mermaid
flowchart TB
    subgraph User["👤 User Layer"]
        UI["React Dashboard<br/><i>Dashboard · New Task · Task View · Context Inspector</i>"]
    end

    subgraph API["⚡ API Layer"]
        FAST["FastAPI Backend<br/><i>POST /tasks · SSE /stream · GET /context</i>"]
    end

    subgraph Agents["🤖 Agent Layer"]
        COORD["Coordinator"]
        RES["Researcher"]
        CODE["Coder"]
        REV["Reviewer"]
        COORD --> RES --> CODE --> REV
    end

    subgraph Intel["🛡️ Intelligence Layer"]
        COP["SRE Copilot<br/><i>Anomaly detection · Auto-heal · Manual escalation</i>"]
        RAM["RAM Context Store<br/><i>task_id · steps · fix_history · retry_count</i>"]
    end

    subgraph LLM["🧠 LLM Provider"]
        GROQ["Groq API<br/><i>OpenAI-compatible · llama-3.3-70b</i>"]
    end

    subgraph Obs["📊 Observability — Planned"]
        OTEL["OpenTelemetry"]
        SIGNOZ["SigNoz<br/><i>Traces · Metrics · Dashboards · MCP</i>"]
        OTEL --> SIGNOZ
    end

    UI <-->|"REST + SSE"| FAST
    FAST --> Agents
    RES & CODE & REV & COORD --> GROQ
    FAST <-->|"read / write"| RAM
    COP <-->|"snapshot + fix hints"| RAM
    REV --> COP
    RES & CODE --> COP
    COP -->|"retry step"| RES & CODE
    FAST -.->|"OTLP spans"| OTEL
    COP -.->|"MCP queries"| SIGNOZ

    style User fill:#eef2ff,stroke:#6366f1
    style API fill:#ecfdf5,stroke:#10b981
    style Agents fill:#fef3c7,stroke:#f59e0b
    style Intel fill:#fce7f3,stroke:#ec4899
    style LLM fill:#f3f4f6,stroke:#6b7280
    style Obs fill:#f9fafb,stroke:#9ca3af,stroke-dasharray:5 5
```

### End-to-End Data Flow

How a single task moves through the system from submission to completion.

```mermaid
flowchart LR
    A(["📝 User submits prompt"]) --> B["FastAPI creates task_id<br/>+ RAM context entry"]
    B --> C["Coordinator decomposes<br/>into 3-step plan"]
    C --> D["Researcher gathers info"]
    D --> E{"Copilot<br/>check"}
    E -->|"OK"| F["Coder produces output"]
    E -->|"Anomaly + retries left"| D2["Retry with fix hint"]
    D2 --> D
    E -->|"Cap reached"| M(["🔴 Manual Mode"])
    F --> G{"Copilot<br/>check"}
    G -->|"OK"| H["Reviewer scores output<br/>semantic_score 0–1"]
    G -->|"Anomaly + retries left"| F2["Retry with fix hint"]
    F2 --> F
    G -->|"Cap reached"| M
    H --> I{"Score ≥ 0.6?"}
    I -->|"Yes"| J(["✅ Success<br/>final_output returned"])
    I -->|"No"| K["Copilot retries Coder"]
    K --> F
    J --> L["SSE complete event<br/>→ React UI"]
    M --> N["SSE manual_mode event<br/>→ developer intervention"]

    style A fill:#dbeafe,stroke:#3b82f6
    style J fill:#d1fae5,stroke:#059669
    style M fill:#fee2e2,stroke:#dc2626
    style L fill:#ede9fe,stroke:#7c3aed
    style N fill:#fef3c7,stroke:#d97706
```

### Request Lifecycle (Sequence)

Real-time interaction between the UI, backend, agents, and Copilot during a task run.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React UI
    participant API as FastAPI
    participant RAM as RAM Store
    participant Agents as Agent Pipeline
    participant LLM as Groq LLM
    participant Copilot as SRE Copilot

    User->>UI: Submit task prompt
    UI->>API: POST /tasks
    API->>RAM: create(task_id, prompt)
    API-->>UI: { task_id, status: running }
    API->>Agents: asyncio background pipeline

    loop Each step — research, code, review
        Agents->>LLM: llm_call(system, user)
        LLM-->>Agents: text + tokens + latency_ms
        Agents->>RAM: update_step(name, output, tokens)
        API-->>UI: SSE status event
        Agents->>Copilot: evaluate(task_id, step)
        Copilot->>RAM: get snapshot
        alt Anomaly detected & retries < 2
            Copilot->>RAM: add_fix(attempt, strategy, hint)
            Copilot-->>Agents: retry with fix_hint
        else Anomaly & cap reached
            Copilot->>RAM: set mode = manual
            API-->>UI: SSE complete — manual_mode
        else All clear
            Copilot-->>Agents: continue
        end
    end

    Agents->>RAM: update(status=success, final_output)
    API-->>UI: SSE complete — success
    UI->>API: GET /tasks/{task_id}
    API->>RAM: get full context
    API-->>UI: TaskResult JSON
    User->>UI: View output + step details
```

### Self-Healing State Machine

The Copilot's decision logic — the **2-strike rule** prevents infinite auto-retry loops.

```mermaid
stateDiagram-v2
    [*] --> Running: Task accepted

    Running --> StepComplete: Agent step finishes
    StepComplete --> Running: Copilot: continue
    StepComplete --> AutoFix1: Copilot: anomaly detected

    AutoFix1 --> Running: Retry succeeds
    AutoFix1 --> AutoFix2: Retry fails

    AutoFix2 --> Running: Retry succeeds
    AutoFix2 --> ManualMode: Retry fails

    Running --> Success: All steps pass
    Success --> [*]: Task done

    ManualMode --> [*]: Developer intervention required

    note right of AutoFix1
        Strategy: reword
        Targeted feedback
        from failure context
    end note

    note right of AutoFix2
        Strategy: rethink
        Completely different
        approach
    end note

    note right of ManualMode
        retry_count ≥ 2
        No further auto-retries
    end note
```

---

## Architecture

### Layer Responsibilities

| Layer | Technology | Status |
|-------|-----------|--------|
| User interface | React + Vite + Tailwind | ✅ Implemented |
| API & orchestration | FastAPI + asyncio | ✅ Implemented |
| Agent execution | Async LLM agents (Groq) | ✅ Implemented |
| Quality evaluation | LLM-as-Judge (Reviewer) | ✅ Implemented |
| Self-healing | SRE Copilot + RAM store | ✅ Implemented |
| Instrumentation | OpenTelemetry → SigNoz | 🔜 Planned |
| External orchestration | n8n workflows | 🔜 Planned |

---

## Repository Structure

```
signoz/                          # Repository root
├── README.md                    # This file
├── n8nforge-observer/           # Main application
│   ├── backend/
│   │   ├── main.py              # FastAPI app, pipeline orchestration, SSE streaming
│   │   ├── config.py            # Environment settings (LLM, Copilot thresholds)
│   │   ├── llm.py               # Async OpenAI-compatible LLM client (Groq)
│   │   ├── context_store.py     # In-memory RAM context store
│   │   ├── copilot.py           # SRE Copilot — anomaly detection & healing
│   │   └── agents/
│   │       ├── coordinator.py   # Task decomposition
│   │       ├── researcher.py    # Information gathering
│   │       ├── coder.py         # Output production
│   │       └── reviewer.py      # LLM-as-Judge scoring
│   ├── frontend/                # React dashboard (v2.0)
│   │   ├── src/
│   │   │   ├── pages/           # Dashboard, NewTask, TaskView, Analytics, ContextInspector
│   │   │   └── lib/api.ts       # Backend API client + SSE subscription
│   │   └── vite.config.ts       # Dev proxy: /api → localhost:8000
│   └── requirements.txt
└── sig/                         # Design & planning docs
    ├── arch.md                  # Full architecture specification
    ├── spec.md                  # Functional requirements
    ├── context.md               # RAM context store design
    └── Plan.md                  # Build & demo plan
```

---

## Quick Start

### Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- **Groq API key** ([console.groq.com](https://console.groq.com)) — or any OpenAI-compatible endpoint

### 1. Backend

```bash
cd n8nforge-observer

# Create virtual environment
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cat > .env << 'EOF'
LLM_API_KEY=your_groq_api_key_here
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.3-70b-versatile
LLM_TEMPERATURE=0.3
MAX_AUTO_FIX_ATTEMPTS=2
SEMANTIC_SCORE_THRESHOLD=0.6
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8000
EOF

# Run the API server
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

Verify: `curl http://localhost:8000/health` → `{"status":"ok","service":"n8nforge-observer"}`

### 2. Frontend

In a second terminal:

```bash
cd n8nforge-observer/frontend
npm install
npm run dev
```

Open **http://localhost:3000** — the Vite dev server proxies `/api` requests to the backend on port 8000.

### 3. Submit a Task

**Via UI:** Go to **New Task**, enter a prompt, and watch live progress on the task detail page.

**Via API:**

```bash
curl -X POST http://localhost:8000/tasks \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Explain the tradeoffs between REST and GraphQL"}'
```

Poll for results:

```bash
curl http://localhost:8000/tasks/<task_id>
```

Stream live events (SSE):

```bash
curl -N http://localhost:8000/tasks/<task_id>/stream
```

---

## Configuration

All settings are loaded from `.env` in the `n8nforge-observer/` directory via `pydantic-settings`.

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_API_KEY` | *(required)* | API key for the LLM provider |
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` | OpenAI-compatible API base URL |
| `LLM_MODEL` | `llama-3.3-70b-versatile` | Model identifier |
| `LLM_TEMPERATURE` | `0.3` | Default sampling temperature |
| `MAX_AUTO_FIX_ATTEMPTS` | `2` | Auto-heal cap before Manual Mode |
| `SEMANTIC_SCORE_THRESHOLD` | `0.6` | Minimum Reviewer score (0.0–1.0) to pass |
| `BACKEND_HOST` | `0.0.0.0` | Server bind address |
| `BACKEND_PORT` | `8000` | Server port |

For production frontend builds, set `VITE_API_URL` to point at your deployed backend (defaults to `http://localhost:8000`).

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/tasks` | Submit a task (`{"prompt": "..."}`) — returns immediately with `task_id` |
| `GET` | `/tasks/{task_id}` | Get full task result (poll until `status != "running"`) |
| `GET` | `/tasks/{task_id}/stream` | SSE stream of live progress events |
| `POST` | `/tasks/{task_id}/cancel` | Cancel a running task |
| `GET` | `/context` | List active task IDs in RAM store |
| `GET` | `/context/{task_id}` | Snapshot of RAM context for a task |

### Task Status Values

| Status | Meaning |
|--------|---------|
| `running` | Pipeline in progress |
| `success` | Completed successfully |
| `manual_mode` | Auto-fix exhausted — developer intervention required |
| `error` | Unhandled exception |
| `cancelled` | Ended by user |

### SSE Events

| Event | Payload |
|-------|---------|
| `status` | Step progress (`step`, `status`, `message`, optional `attempt`) |
| `complete` | Final status (`success`, `manual_mode`, `cancelled`) |
| `error` | Error details |

---

## Agent Pipeline

Each submitted task runs through this sequence (see [End-to-End Data Flow](#end-to-end-data-flow) above):

```mermaid
flowchart TD
    P(["User Prompt"]) --> C["① Coordinator<br/>Decompose into plan"]
    C --> R["② Researcher<br/>Gather information"]
    R --> RC{"Copilot gate"}
    RC -->|"pass"| CO["③ Coder<br/>Produce deliverable"]
    RC -->|"heal"| RH["Apply fix hint → retry"]
    RH --> R
    CO --> CC{"Copilot gate"}
    CC -->|"pass"| RV["④ Reviewer<br/>LLM-as-Judge score"]
    CC -->|"heal"| CH["Apply fix hint → retry"]
    CH --> CO
    RV --> SC{"score ≥ threshold?"}
    SC -->|"yes"| OK(["✅ Task complete"])
    SC -->|"no"| CO
    RC -->|"manual"| MM(["🔴 Manual Mode"])
    CC -->|"manual"| MM

    style P fill:#dbeafe,stroke:#3b82f6
    style OK fill:#d1fae5,stroke:#059669
    style MM fill:#fee2e2,stroke:#dc2626
```

Every agent call returns **token count** and **latency** metadata, tracked per step in the RAM context store.

---

## SRE Copilot & Self-Healing

The Copilot (`backend/copilot.py`) evaluates each agent step and decides: **continue**, **retry**, or **manual**.

### Anomaly Signals

- Agent exceptions / explicit errors
- Reviewer semantic score below `SEMANTIC_SCORE_THRESHOLD` (default 0.6)
- Nearly empty agent output (< 20 characters)

### Healing Strategies

| Attempt | Strategy | Behavior |
|---------|----------|----------|
| 1 | `reword` | Retry with targeted feedback from failure context |
| 2 | `rethink` | Retry with a completely different approach |
| 3+ | — | Switch to **Manual Mode** — no further auto-retries |

### State Machine

See the full [Self-Healing State Machine](#self-healing-state-machine) diagram in System Diagrams.

The **2-strike cap** is intentional: it prevents the healing mechanism itself from becoming an infinite retry loop — the exact failure mode this project is designed to solve.

---

## Frontend

The React UI (`n8nforge-observer/frontend/`) provides:

| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/` | Backend health, active tasks, quick actions |
| New Task | `/new` | Submit prompts to the pipeline |
| Task View | `/task/:taskId` | Live SSE progress, step outputs, final result |
| Analytics | `/analytics` | Metrics the system tracks (tokens, latency, healing) |
| Context Inspector | `/context` | Live RAM context snapshots per active task |

**Stack:** React 18, TypeScript, Vite, Tailwind CSS, React Router, Lucide icons.

---

## Roadmap

Items from the design spec (`sig/`) not yet implemented in code:

- [ ] **OpenTelemetry instrumentation** — spans around every agent/tool call with token counts, latency, and semantic scores exported via OTLP
- [ ] **SigNoz integration** — trace waterfalls, dashboards (MTTR, fix-success rate, token cost)
- [ ] **SigNoz MCP Copilot** — query traces/metrics from SigNoz for richer anomaly detection (loop patterns, latency spikes)
- [ ] **n8n workflow orchestration** — webhook-driven intake and step re-trigger for manual fix mode
- [ ] **Docker Compose** — one-command local deployment with SigNoz
- [ ] **Persistent task history** — cross-session analytics in the frontend

See [`sig/Plan.md`](sig/Plan.md) for the full phased build plan and demo script.

---

## Documentation

Detailed design documents live in [`sig/`](sig/):

| Document | Contents |
|----------|----------|
| [`arch.md`](sig/arch.md) | Full architecture, component design, data flow |
| [`spec.md`](sig/spec.md) | Functional/non-functional requirements, acceptance criteria |
| [`context.md`](sig/context.md) | RAM context store data model and lifecycle |
| [`Plan.md`](sig/Plan.md) | Build phases, demo script, risk mitigations |

---

## License

Hackathon submission for **Agents of SigNoz 2026**.
