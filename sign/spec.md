# spec.md — n8nForge Observer: Technical Specification

**Version:** 1.0 (Hackathon Ready)
**Hackathon:** Agents of SigNoz 2026 — Track 1: AI & Agent Observability

---

## 1. Purpose

n8nForge Observer is a hybrid multi-agent AI system that gives full observability into agentic workflows and adds a hybrid (automatic + manual) self-healing layer on top. This document specifies the functional and non-functional requirements, components, interfaces, and acceptance criteria for the hackathon build.

## 2. Problem Statement

AI agent teams commonly suffer from:
- Infinite loops and repeated failures
- High token waste from blind retries
- Silent quality degradation (agents "succeed" but produce worse output)
- Poor coordination between agents

**Goal:** provide total visibility into agent execution, plus automatic and manual recovery paths, so failures are caught early, fixed cheaply, and never silently repeated.

## 3. Scope

### In scope (v1.0)
- Single n8n workflow orchestrating a 4-agent CrewAI crew (Researcher, Coder, Reviewer, Coordinator)
- OpenTelemetry instrumentation of every agent call and tool call
- LLM-as-Judge semantic evaluation attached as span attributes
- In-memory (RAM-only) context store, keyed by `task_id`, no persistence
- SRE Copilot: an MCP client that reads SigNoz traces/metrics and RAM context to detect anomalies
- Hybrid self-healing: 2 automatic incremental-fix attempts, then fallback to manual mode
- SigNoz dashboards for traces, token cost, MTTR, fix success rate
- Docker Compose deployment for local/demo use

### Out of scope (v1.0)
- Persistent storage / database-backed memory across sessions
- Multi-tenant auth, RBAC, or production-grade security hardening
- Horizontal scaling of the RAM store (single-instance only)
- Non-English task inputs (not tested)

## 4. Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-1 | System accepts a task via n8n Webhook and generates a unique `task_id` and root `trace_id`. |
| FR-2 | System stores initial task context (prompt, plan, retry count) in an in-memory store. |
| FR-3 | Coordinator agent decomposes the task and assigns subtasks to Researcher and Coder. |
| FR-4 | Every agent/tool invocation emits an OpenTelemetry span with token count, latency, model, and tool-call metadata. |
| FR-5 | Reviewer agent scores each output using an LLM-as-Judge rubric and attaches `semantic_score` to the span. |
| FR-6 | SRE Copilot polls SigNoz (via MCP) for anomaly signals: repeated identical tool calls, low semantic score, latency/token spikes, error spans. |
| FR-7 | On anomaly, Copilot attempts an automatic incremental fix using only the compact RAM context (not full trace history). |
| FR-8 | If two automatic fix attempts fail, the system switches to Manual Fix Mode and freezes further auto-retries. |
| FR-9 | In Manual Fix Mode, the developer can view the trace, span attributes, and RAM snapshot in SigNoz, then manually re-trigger the failing step via n8n. |
| FR-10 | On task success (auto or manual), the system clears the RAM entry for that `task_id`. |
| FR-11 | System returns a final report to the user: steps taken, retries, fixes applied, token/cost summary. |
| FR-12 | SigNoz dashboards show success rate, average fixes-per-task, token cost, and MTTR split by auto vs. manual resolution. |

## 5. Non-Functional Requirements

- **Observability-first:** every state transition must be traceable end-to-end via `trace_id`.
- **Statelessness between tasks:** no cross-session memory; RAM store must be fully cleared on completion or explicit cleanup.
- **Loop safety:** hard cap of 2 automatic fix attempts before mandatory human handoff.
- **Low overhead:** instrumentation should not add more than ~10–15% latency to agent calls in the demo environment.
- **Local-first deployment:** must run via `docker-compose up -d` with no external managed dependencies beyond LLM API and SigNoz.

## 6. Control Modes

| Mode | Description |
|------|-------------|
| **Automatic** | Copilot handles fixes using RAM context (default first attempt). |
| **Manual** | Developer has full control with deep SigNoz visibility after 2 failed auto-fixes. |
| **Hybrid** | Automatic first, falls back to manual — this is the default operating mode for v1.0. |

## 7. Success Criteria (Hackathon Demo)

1. A submitted task produces a visible, correlated trace in SigNoz from webhook → agents → final output.
2. An injected failure (e.g., a bad tool call or deliberately low-quality output) triggers at least one automatic incremental fix.
3. A second injected failure on the same task triggers the switch to Manual Fix Mode, visible as an alert/annotation in SigNoz.
4. RAM context is visibly cleared after task completion (demonstrable via a `context_store` inspection endpoint or log line).
5. Dashboards show at least: trace waterfall, token cost per task, and auto-fix vs. manual-fix counts.

## 8. Open Questions / Risks

- LLM-as-Judge scoring consistency across runs (may need a fixed rubric + low temperature).
- MCP round-trip latency between Copilot and SigNoz under demo network conditions.
- Defining "identical tool call" for loop detection (exact match vs. semantic similarity).
