# context.md — RAM Context Store Design

## 1. Purpose

The Context Store (`backend/context_store.py`) is the shared, ephemeral working memory for a single task's lifecycle. It gives the SRE Copilot enough situational awareness to generate a targeted fix without re-reading the entire trace history, and it gives agents a shared scratchpad within a task run.

## 2. Design Principles

- **In-memory only, no database.** Speed and simplicity over durability. Nothing here needs to survive a process restart.
- **Keyed by `task_id`.** One context entry per active task; no cross-task leakage.
- **Compact by design.** Stores the minimum state needed to reason about "what has been tried and what happened," not full transcripts or raw trace dumps.
- **Ephemeral lifecycle.** Created at task intake, mutated during execution, and deleted automatically on success — or manually by the developer during a stuck Manual Fix Mode session.

## 3. Data Model

Each entry in the store is a dict keyed by `task_id`:

```python
{
  "task_id": "task_abc123",
  "trace_id": "trace_def456",
  "original_prompt": "Research X and write a summary report",
  "task_plan": [
    {"step": "research", "assigned_to": "Researcher", "status": "done"},
    {"step": "draft", "assigned_to": "Coder", "status": "in_progress"},
    {"step": "review", "assigned_to": "Reviewer", "status": "pending"}
  ],
  "agent_state": {
    "Researcher": {"last_output_summary": "...", "tool_calls": 3},
    "Coder": {"last_output_summary": "...", "tool_calls": 1},
    "Reviewer": {"last_semantic_score": 0.42}
  },
  "retry_count": 1,
  "fix_history": [
    {"attempt": 1, "type": "automatic", "action": "reworded prompt to Coder", "result": "fail"}
  ],
  "mode": "automatic",  # automatic | manual
  "created_at": "2026-07-23T10:00:00Z",
  "updated_at": "2026-07-23T10:02:15Z"
}
```

## 4. Core Operations

| Operation | Description |
|-----------|-------------|
| `create(task_id, trace_id, prompt)` | Initializes a new context entry at task intake. |
| `get(task_id)` | Returns the current context snapshot for a task. |
| `update_agent_state(task_id, agent, state)` | Called after each agent step to record progress. |
| `record_fix_attempt(task_id, type, action, result)` | Appends to `fix_history` and increments `retry_count` on automatic attempts. |
| `set_mode(task_id, mode)` | Switches between `automatic` and `manual`. |
| `clear(task_id)` | Deletes the entry entirely — called on success or explicit developer cleanup. |

## 5. How the Copilot Uses Context

When an anomaly is detected for a `task_id`:

1. Copilot calls `get(task_id)` to retrieve the compact snapshot (not the full OpenTelemetry trace).
2. It reasons over `task_plan`, `agent_state`, and `fix_history` to decide what changed and what to try next.
3. It calls `record_fix_attempt(...)` before/after applying a fix, so the next anomaly check has full memory of what was already tried — this is what prevents attempt 1 and attempt 2 from repeating the same fix.
4. If `retry_count` reaches 2 for a given task, Copilot calls `set_mode(task_id, "manual")` and stops attempting further automatic fixes.

## 6. Lifecycle Diagram

```
create() on task intake
   │
   ▼
update_agent_state() ── per agent step
   │
   ▼
[anomaly detected] → get() → record_fix_attempt() → retry
   │
   ├─ success → clear()
   └─ retry_count == 2 → set_mode("manual") → developer resolves → clear()
```

## 7. Constraints & Tradeoffs

- **No persistence:** a backend restart mid-task loses all in-flight context. Acceptable for a hackathon demo; flagged as a v2 concern (e.g., Redis-backed store) if asked about scaling.
- **Single-instance only:** the store is a local process dict, not shared across replicas. Fine for the demo's single-container deployment.
- **No cross-session memory:** once `clear()` runs, there is no learning carried into the next task. This is intentional — it keeps healing scoped and predictable, at the cost of not building up longer-term pattern recognition across tasks.

## 8. Optional: Debug/Inspection Endpoint

For demo purposes, expose a read-only FastAPI endpoint (e.g., `GET /context/{task_id}`) so judges can see the live RAM snapshot disappear the moment a task completes — this is a strong, visual way to prove the "automatic RAM cleanup" claim during the demo.
