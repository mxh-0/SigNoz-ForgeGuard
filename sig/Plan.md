# Plan.md — Build & Execution Plan

**Project:** n8nForge Observer
**Hackathon:** Agents of SigNoz 2026 — Track 1: AI & Agent Observability

## 1. Guiding Principle

Build in the same order the data flows: intake → agents → tracing → observability → intelligence/healing → polish. Each phase should be demoable on its own before moving to the next, so there's always a fallback working state before the deadline.

## 2. Phase Breakdown

### Phase 0 — Setup (Day 1, morning)
- [ ] Scaffold repo structure (`n8n/`, `backend/`, `dashboards/`, `docker-compose.yml`, `.env.example`)
- [ ] Stand up SigNoz locally via Docker Compose
- [ ] Confirm LLM API access (keys in `.env`)
- [ ] Confirm n8n instance runs and can reach the backend container

### Phase 1 — Task Intake & Orchestration (Day 1)
- [ ] Build n8n Webhook workflow: accept task, generate `task_id` + `trace_id`
- [ ] Wire webhook to FastAPI backend (`main.py`) stub endpoint
- [ ] Implement `context_store.py`: `create`, `get`, `clear`
- [ ] **Checkpoint demo:** submit a task, see `task_id` created and context entry appear

### Phase 2 — Agent Layer (Day 1–2)
- [ ] Implement CrewAI agents: Coordinator, Researcher, Coder, Reviewer
- [ ] Coordinator: task decomposition + subtask assignment logic
- [ ] Researcher: retrieval/search tool integration, writes findings to context
- [ ] Coder: consumes Researcher output, produces artifact
- [ ] Reviewer: LLM-as-Judge rubric, emits `semantic_score`
- [ ] `update_agent_state()` called after each step
- [ ] **Checkpoint demo:** full agent pipeline runs end-to-end on a sample task, no tracing yet

### Phase 3 — Instrumentation (Day 2)
- [ ] Implement `instrumentation.py`: OpenTelemetry spans around every agent/tool call
- [ ] Capture token counts, latency, model name, tool params, `semantic_score`
- [ ] Export via OTLP to SigNoz, tagged with shared `trace_id`
- [ ] **Checkpoint demo:** trace waterfall for a full task run visible in SigNoz

### Phase 4 — SRE Copilot & Anomaly Detection (Day 2–3)
- [ ] Implement `copilot.py` as an MCP client against SigNoz's MCP server
- [ ] Define anomaly signals: repeated tool calls, low `semantic_score`, latency/token spikes, error spans
- [ ] Implement polling loop (or event-driven check) that queries SigNoz + RAM context
- [ ] **Checkpoint demo:** deliberately inject a bad tool call → Copilot flags it as an anomaly in logs/SigNoz

### Phase 5 — Hybrid Self-Healing (Day 3)
- [ ] Implement automatic incremental fix logic (attempt 1): Copilot proposes a targeted patch from RAM context, re-injects it, n8n re-runs the failing step
- [ ] Implement `record_fix_attempt()` bookkeeping and `retry_count` increment
- [ ] Implement attempt 2 with updated context
- [ ] Implement fallback: `set_mode(task_id, "manual")` after 2 failures, freeze auto-retries, raise SigNoz alert/annotation
- [ ] Build minimal manual-intervention path: developer view of trace + RAM snapshot, manual re-trigger via n8n
- [ ] **Checkpoint demo:** inject 2 consecutive failures → system switches to Manual Fix Mode visibly in SigNoz

### Phase 6 — Cleanup & Reporting (Day 3)
- [ ] Implement `clear(task_id)` on success path
- [ ] Build final report generator: steps taken, retries, fixes applied, token/cost summary
- [ ] Optional debug endpoint `GET /context/{task_id}` to visually prove RAM cleanup during demo

### Phase 7 — Dashboards & Polish (Day 3–4)
- [ ] Build SigNoz dashboards: trace waterfall view, token cost per task, MTTR (auto vs. manual), fix-success rate
- [ ] Export dashboard JSON into `dashboards/`
- [ ] Write `README.md` (quick start, architecture summary, demo script)
- [ ] Rehearse full demo run at least twice, including a deliberate double-failure scenario

## 3. Demo Script Outline (for judges)

1. Show architecture diagram (30s) — orchestration, agents, tracing, observability, healing.
2. Submit a clean task → walk through the live SigNoz trace as it appears (60s).
3. Submit a task with an injected failure → show automatic incremental fix succeed on attempt 1 (60s).
4. Submit a task with a harder injected failure → show attempt 1 and 2 fail, system switches to Manual Fix Mode, alert appears in SigNoz (60s).
5. Show developer manually resolving via the trace + RAM snapshot, task completes, RAM clears (45s).
6. Show dashboards: cost, MTTR auto vs. manual, fix-success rate (30s).
7. Close on the two narrative hooks: "2-strike rule prevents the exact failure mode we're solving," and "RAM context tied to trace_id makes healing explainable, not a black box."

## 4. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| LLM-as-Judge scores are inconsistent run-to-run | Fix rubric wording, use low temperature, test on 3–5 sample tasks ahead of demo |
| MCP round-trip latency during live demo | Pre-warm connections; have a recorded backup trace/dashboard as fallback |
| Time runs out before healing logic is solid | Phases 1–3 are demoable alone; healing (Phase 4–5) is the stretch differentiator — protect time for it but don't block the base demo on it |
| Anomaly detection triggers false positives | Start with conservative thresholds (exact repeated tool calls, hard score cutoff) rather than fuzzy heuristics |

## 5. Definition of Done (v1.0)

- End-to-end task run is fully traced and visible in SigNoz.
- At least one automatic fix and one manual-mode fallback are demonstrably reproducible.
- RAM context store visibly clears on task completion.
- Dashboards and README are complete enough for judges to review after the live demo.
