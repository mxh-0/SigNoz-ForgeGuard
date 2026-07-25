# SignozForge Observer — Project Documentation

---

## 1. Problem Statement

AI agent systems are increasingly being deployed to automate complex tasks — code generation, research synthesis, report writing, technical analysis. But they have a critical blind spot: **they cannot reliably evaluate the quality of their own output.**

Consider this real scenario:

> A developer asks an AI agent to "fix the broken migration in table users_v3 on my PostgreSQL database." The agent returns a 2000-word response full of SQL examples, structured headings, and confident language. The built-in reviewer scores it 0.82/1.0 — a passing grade. The output is delivered as "complete."
>
> But the actual content says: "you would need to determine the database credentials," "contact the database administrator," "assuming the migration is broken because of a missing column." It solved nothing. It described a process instead of executing one.

This is the norm, not the exception. Current AI systems:

- Produce **placeholder and hedging text** disguised as solutions
- Score their own output generously because it is well-structured and grammatically correct
- **Loop on retries** — producing the same generic answer repeatedly without improvement
- Have no memory of what has failed before, so they repeat the same mistakes
- Give the developer **no visibility** into why something failed or what the system tried

The result: developers lose trust in AI agents because they cannot tell the difference between a good result and a confident-sounding failure until they have read the entire output.

---

## 2. Our Solution

SignozForge Observer is a **self-healing multi-agent system** with an SRE Copilot supervisor that catches bad output before the developer ever sees it.

The core insight: instead of trusting a single quality score, we run **7 independent anomaly detectors** that examine the actual content of every agent output — checking for hedging language, placeholder phrases, code completeness, topic relevance, and loop patterns. When a problem is found, the system doesn't just flag it — it **repairs it automatically** using a structured healing path, informed by historical performance data from SigNoz.

### What makes this different

| Traditional Agent System | SignozForge Observer |
|---|---|
| Single reviewer score decides pass/fail | 7 independent detectors + reviewer critique analysis |
| Score 0.82 = "passing" | Score 0.82 with negative reasoning = anomaly detected |
| Retries use the same prompt | Retries are informed by failure context + SigNoz historical data |
| No visibility into failures | Every anomaly, healing attempt, and decision is traced in SigNoz |
| Infinite retry loops possible | Hard 2-strike cap, then explicit manual mode |
| Developer finds out output is bad after reading it | Developer is told immediately + shown what was tried |

---

## 3. System Architecture

### The Agent Layer

Four specialized agents form the execution pipeline:

1. **Coordinator** — Receives the developer's task and decomposes it into a 3-step plan (research → build → review). This ensures every task follows a structured approach regardless of complexity.

2. **Researcher** — Gathers the facts, constraints, and context needed for the build step. Focuses on concise, actionable information rather than exhaustive coverage.

3. **Coder** — Produces the actual deliverable. This is the artifact the developer cares about — code, analysis, documentation, or whatever was requested. It receives the research output as input.

4. **Reviewer** — Scores the Coder's output on 5 dimensions (completeness, accuracy, clarity, depth, usefulness) using an LLM-as-Judge pattern. Returns a structured score and reasoning.

### The SRE Copilot (Supervisor Layer)

The Copilot sits above the agent layer and monitors every step. It is called after each agent completes:

```
Agent step completes
       |
       v
Copilot evaluates output (7 detectors)
       |
       ├── No anomaly --> continue to next step
       |
       └── Anomaly detected --> query SigNoz for context
                                       |
                                       v
                              Decide: retry or manual?
                                       |
                              ┌────────┴────────┐
                              |                  |
                         Strike 1:          Strike 2:
                          REWORD             RETHINK
                     (targeted fix)    (new approach)
                              |                  |
                              └────────┬─────────┘
                                       |
                                  Still fails?
                                       |
                                       v
                                 MANUAL MODE
                          (hand to developer with
                           partial output + reason)
```

The 2-strike cap is not arbitrary — it prevents infinite healing loops. Two fundamentally different retry strategies (reword vs rethink) give the system the best chance of recovery without wasting tokens or time.

### The Observability Layer (SigNoz)

SigNoz is the third critical layer. It serves two purposes:

1. **Transparency** — Every agent step, LLM call, and Copilot decision is traced. Developers and operators can see exactly what happened, how long it took, and why decisions were made.

2. **Intelligence** — The Copilot reads data back from SigNoz before deciding how to retry. If the LLM is currently slow, the retry asks for conciseness. If a step has been historically unreliable, the Copilot adjusts its expectations.

---

## 4. Where SigNoz Is Used

SigNoz is not an afterthought or optional monitoring layer. It is deeply integrated into the decision-making process.

### 4.1 Exporting Telemetry (Observability)

Every meaningful action in the system creates a trace span:

- **Agent spans** (`agent.coordinator`, `agent.researcher`, `agent.coder`, `agent.reviewer`) — with attributes: task ID, token count, latency, output length
- **LLM call spans** (`llm.call`) — with: model name, prompt/completion tokens, latency, retry count, rate limit status, which agent made the call
- **Copilot decision spans** (`copilot.evaluate`) — with: decision (continue/retry/manual), anomaly type, strategy, attempt number, and the SigNoz context that informed the decision

Custom metrics are continuously exported:

- `signozforge.copilot.anomalies_detected` — broken down by anomaly type and agent step
- `signozforge.copilot.healing_attempts` — by strategy (reword/rethink) and step
- `signozforge.copilot.healing_successes` — how often fixes actually worked
- `signozforge.copilot.manual_mode_triggers` — escalation rate
- `signozforge.llm.latency_ms` — histogram of LLM response times
- `signozforge.llm.errors_total` — by type: timeout, rate_limit, http_error
- `signozforge.tasks.submitted/completed/failed` — the task funnel

### 4.2 Reading Data Back (Intelligence)

This is the key differentiator. Before making a healing decision, the Copilot calls the SigNoz Query Service API:

**Query 1: Step health** — "Has this agent step been failing a lot in the last 30 minutes?"
- If yes: the Copilot adds extra context to the fix hint ("this step has been unreliable, take extra care")
- If the step is degraded (avg latency >10s): might indicate an LLM issue, not a prompt issue

**Query 2: LLM health** — "Is the LLM provider currently degraded?"
- If p95 latency is above 15s: the Copilot adjusts its retry to ask for shorter, more focused output
- If rate limit hits are high: the system knows throughput is constrained and adapts

**Query 3: Healing history** — "What is the historical success rate of healing attempts?"
- If success rate is below 30%: the Copilot warns the agent "this is your last chance before manual mode"
- This prevents wasting retries on prompts that historically never succeed

**Query 4: Recent error traces** — "What went wrong last time on this step?"
- Feeds previous failure context directly into the fix hint, so the retry has awareness of past mistakes

### 4.3 Why SigNoz Is Essential (Not Optional)

Without SigNoz:
- The Copilot still detects anomalies (the 7 detectors work on raw text)
- But it retries blindly — no historical context, no LLM health awareness
- Developers have no visibility into what the system tried and why it failed
- There is no way to measure whether the healing system is actually working over time

With SigNoz:
- The Copilot makes informed decisions based on actual system state
- Developers can trace any task end-to-end and see exactly where it went wrong
- Operators can monitor healing effectiveness and tune thresholds
- The system improves its behavior based on accumulated data

---

## 5. Where n8n Concepts Are Used

The project name "SignozForge" reflects the workflow orchestration philosophy inspired by n8n:

### Workflow-as-Pipeline

Like n8n's node-based workflows, our agent pipeline is a directed graph of specialized processors:

```
[Task Input] → [Coordinator Node] → [Researcher Node] → [Coder Node] → [Reviewer Node] → [Output]
                                                                              ↓
                                                                      [Copilot Observer]
                                                                         ↓       ↓
                                                                    [Retry]  [Manual Mode]
```

Each "node" (agent) has:
- A defined input schema (prompt + context from previous step)
- A defined output schema (text + token count + latency)
- Error handling that routes to the Copilot
- The ability to be re-executed with modified input (healing)

### Event-Driven Execution

Like n8n's trigger-based workflows:
- Task submission triggers the pipeline
- Each step completion triggers Copilot evaluation
- Anomaly detection triggers the healing path
- All events are streamed live to the frontend via SSE

### Observable Workflows

n8n provides execution history and step-by-step visibility. We extend this with:
- Full distributed tracing (every step is a span in SigNoz)
- Custom metrics that measure workflow health over time
- A feedback loop where historical execution data influences future decisions

---

## 6. How the Proposed System Overcomes Existing Limitations

### Problem 1: "Confident garbage" passes quality checks

**Before:** A reviewer scores output 0.82 and it ships. The text is well-structured but says nothing actionable.

**Our solution:** The Copilot runs 7 detectors independently of the score. Even at 0.82, if the reviewer's own reasoning contains phrases like "lacks specific details" or "prevents it from being fully useful," the Copilot catches it. Additionally, we enforce a strict floor of 0.88 — "passing" is not "good enough."

### Problem 2: Generic hedging text masquerades as solutions

**Before:** "You would need to determine the credentials, assuming the migration is broken, replace X with the actual value" gets delivered as a solution.

**Our solution:** A dedicated vagueness detector checks for 25+ hedging phrases. If 2 or more are found, the output is flagged regardless of how long or well-formatted it is. This is the single most impactful detector — it catches the exact failure mode that other systems miss.

### Problem 3: Retries produce the same bad output

**Before:** System retries 5 times, gets essentially the same generic answer each time, wastes tokens.

**Our solution:** Loop detection compares every output against all previous outputs of the same step using Jaccard similarity. If similarity exceeds 80%, it's caught immediately. Combined with the 2-strike cap, infinite loops are impossible.

### Problem 4: No visibility into what went wrong

**Before:** Task completes or fails. Developer gets an output or an error. No context on what was tried, what was rejected, or why.

**Our solution:** Every anomaly, every healing attempt, and every Copilot decision is:
1. Logged visually in the backend terminal (for development)
2. Streamed live to the frontend (for the developer)
3. Traced in SigNoz (for operators and post-mortem analysis)

### Problem 5: Retry strategy is context-free

**Before:** When a retry happens, it uses the same approach regardless of system state. If the LLM is degraded, the retry still asks for long-form output and times out.

**Our solution:** The Copilot queries SigNoz for current LLM health, step reliability, and historical healing success rate. It adapts:
- LLM slow? Ask for concise output.
- Step historically unreliable? Add extra caution to the prompt.
- Healing rarely works here? Escalate faster.

### Problem 6: No distinction between "fixable" and "unfixable" tasks

**Before:** System retries indefinitely, or gives up after a single failure.

**Our solution:** The 2-strike healing path provides two fundamentally different strategies (reword = targeted fix, rethink = new approach). If both fail, the system acknowledges the task is beyond its capability and explicitly says so. Manual mode is not a failure — it's an honest signal.

---

## 7. Key Technical Decisions

| Decision | Rationale |
|---|---|
| RAM-only context (no database) | Per-task ephemeral state. No cross-session memory needed. Simpler, faster, no infrastructure dependency. |
| Groq over OpenAI | Free tier with fast inference for demo. Architecture is LLM-agnostic (any OpenAI-compatible API). |
| SSE over WebSocket | Simpler protocol for unidirectional server-to-client streaming. No connection upgrade complexity. |
| 2-strike cap (not 3, not 5) | Two fundamentally different strategies (reword vs rethink) covers the repair space. More attempts waste tokens without new information. |
| SigNoz standalone Docker | Single container for the full observability stack. Judges can reproduce with one command. |
| Client-side thread history | Conversation threading lives in localStorage, not the backend. Keeps the backend stateless per the RAM-only design. |
| 0.88 strict score floor (not 0.6) | The configured 0.6 is the hard fail threshold. 0.88 is the Copilot's own bar — "passing is not good enough." |

---

## 8. Reproducibility

The complete system can be reproduced locally with two commands:

```bash
# 1. Start SigNoz (all-in-one container)
docker run -d --name signoz --privileged \
  -p 3301:8080 -p 4317:4317 -p 4318:4318 \
  -v signoz-clickhouse:/var/lib/clickhouse \
  -v signoz-data:/var/lib/signoz \
  signoz/signoz-standalone:latest

# 2. Start the application stack
docker compose up -d --build
```

Requirements:
- Docker Desktop with 6 GB RAM allocated
- A Groq API key in `.env`
- Internet access (for LLM calls)

Access:
- Application frontend: http://localhost:5173
- Backend API: http://localhost:8000
- SigNoz dashboard: http://localhost:3301

---

## 9. Demo Guide

### Scenario A: Successful task (no Copilot intervention)

**Input:** "Write a Python function that reverses a string"

**What to observe:**
- Pipeline completes all 4 stages with green checkmarks
- Backend terminal shows `[COPILOT] No anomaly in 'research' -- continuing` for each step
- Output is well-formatted code with tests
- SigNoz shows a clean trace with all spans succeeding

**What this demonstrates:** The system works efficiently when output is genuinely good. The Copilot does not interfere unnecessarily.

### Scenario B: Copilot detects and heals (the key demo)

**Input:** "Connect to my local PostgreSQL database at 192.168.1.50 and fix the broken migration in table users_v3"

**What to observe:**
- Coder produces hedging text ("you would need to...", "assuming the...")
- Backend terminal shows the `[ANOMALY DETECTED]` banner with detection details
- Frontend shows a red "Anomaly Detected" card in the live pipeline
- Copilot triggers healing — backend shows `[COPILOT HEALING] Attempt 1 - REWORD`
- Frontend shows amber "Copilot Healing" card
- After 2 failed attempts: `[MANUAL MODE ACTIVATED]` in the terminal
- Frontend switches to Manual Mode with explanation

**What this demonstrates:** The system catches confident-sounding garbage that would normally pass, tries to fix it, and honestly escalates when it cannot.

### Scenario C: SigNoz integration

After running Scenarios A and B:
1. Open http://localhost:3301 (SigNoz)
2. Navigate to Services → `signozforge-observer`
3. View traces: see the full pipeline waterfall with spans for each agent and LLM call
4. View the `copilot.evaluate` spans: see `anomaly_type`, `decision`, `strategy` attributes
5. Check Metrics Explorer: see `signozforge_copilot_anomalies_detected_total` increasing

**What this demonstrates:** Full observability. Every decision is traceable, every metric is measurable.

---

## 10. Future Work

- **Persistent healing memory:** Store successful fix strategies in a vector database, retrieve them for similar future tasks
- **Adaptive thresholds:** Use SigNoz metrics to automatically tune the 0.88 score floor based on observed quality distribution
- **Multi-model fallback:** If the primary LLM is degraded (detected via SigNoz metrics), automatically switch to a backup model
- **SigNoz alerting integration:** Configure SigNoz alerts when healing success rate drops below a threshold, triggering operator notification
- **Tool-use agents:** Extend agents to call external tools (web search, code execution) with the same observability and healing guarantees

---

