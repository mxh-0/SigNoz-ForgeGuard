"""
SignozForge Observer — API
Endpoints:
  POST /tasks          — submit a task (returns immediately with task_id)
  GET  /tasks/{id}     — get full task result (poll until complete)
  GET  /tasks/{id}/stream — SSE stream of live progress events
  GET  /context/{id}   — view RAM context snapshot
  GET  /context        — list active tasks
  GET  /health         — healthcheck
"""
from __future__ import annotations

import asyncio
import json
import traceback
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from backend.config import settings
from backend.context_store import store, new_task_id, StepInfo, TaskContext
from backend.agents import coordinator, researcher, coder, reviewer
from backend.copilot import evaluate, mark_fix_result

# OpenTelemetry + SigNoz (core integration)
from backend.instrumentation import (
    setup_telemetry, start_agent_span, agent_step_latency,
    tasks_submitted, tasks_completed, tasks_failed,
)
setup_telemetry()

app = FastAPI(title="SignozForge Observer", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# SSE event queues per task
_event_queues: dict[str, asyncio.Queue] = {}


def _emit(task_id: str, event: str, data: dict):
    """Push an SSE event to any listening clients."""
    q = _event_queues.get(task_id)
    if q:
        q.put_nowait({"event": event, "data": json.dumps(data)})


def _emit_anomaly(task_id: str, step: str, decision):
    """Surface a Copilot anomaly to the live pipeline in the frontend."""
    if decision.action in ("retry", "manual") and decision.reason:
        _emit(task_id, "status", {
            "step": "anomaly",
            "status": "anomaly",
            "message": f"ANOMALY DETECTED — {decision.reason}",
        })


# ── Models ────────────────────────────────────────────────────────────────────

class TaskSubmit(BaseModel):
    prompt: str


class TaskResult(BaseModel):
    task_id: str
    status: str
    prompt: str
    steps: list[dict] = []
    final_output: str = ""
    total_tokens: int = 0
    retry_count: int = 0
    fix_history: list[dict] = []
    anomalies: list[dict] = []
    mode: str = "automatic"
    error: str = ""


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "signozforge-observer"}


@app.post("/tasks")
async def submit_task(body: TaskSubmit):
    """Submit a task. Pipeline runs in background. Returns task_id immediately."""
    task_id = new_task_id()
    await store.create(task_id, body.prompt)
    _event_queues[task_id] = asyncio.Queue()

    # Record in SigNoz
    tasks_submitted.add(1)

    # Run pipeline in background so the HTTP response returns instantly
    asyncio.create_task(_run_pipeline(task_id, body.prompt))

    return {"task_id": task_id, "status": "running", "message": "Task accepted. Pipeline starting."}


@app.get("/tasks/{task_id}")
async def get_task(task_id: str):
    """Get full task result. Poll this until status != 'running'."""
    ctx = await store.get(task_id)
    if not ctx:
        raise HTTPException(404, "Task not found — may have been cleared.")
    return _ctx_to_result(ctx)


@app.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: str):
    """Cancel/end a running task. Clears RAM context and stops the pipeline."""
    ctx = await store.get(task_id)
    if not ctx:
        raise HTTPException(404, "Task not found.")
    # Mark as cancelled — keep in store so frontend can still read it
    await store.update(task_id, status="cancelled", mode="cancelled")
    _emit(task_id, "complete", {"status": "cancelled", "message": "Task ended by user."})
    _event_queues.pop(task_id, None)
    return {"task_id": task_id, "status": "cancelled", "message": "Task ended."}


@app.get("/tasks/{task_id}/stream")
async def stream_task(task_id: str):
    """SSE stream of live progress events for a task."""
    q = _event_queues.get(task_id)
    if not q:
        # Task might have finished already — send a final event from stored state
        ctx = await store.get(task_id)
        if ctx and ctx.status != 'running':
            async def done_gen():
                yield {"event": "complete", "data": json.dumps({"status": ctx.status})}
            return EventSourceResponse(done_gen())
        raise HTTPException(404, "Task not found or already completed.")

    async def event_generator():
        while True:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=60)
                yield msg
                if msg["event"] == "complete" or msg["event"] == "error":
                    break
            except asyncio.TimeoutError:
                yield {"event": "ping", "data": "{}"}

    return EventSourceResponse(event_generator())


@app.get("/context/{task_id}")
async def get_context(task_id: str):
    snapshot = await store.snapshot(task_id)
    if not snapshot:
        raise HTTPException(404, "Context cleared — task completed.")
    return snapshot


@app.get("/context")
async def list_contexts():
    active = await store.list_active()
    return {"active_tasks": active, "count": len(active)}


@app.get("/signoz/health")
async def signoz_health():
    """Check if SigNoz is available and return connection status."""
    from backend.signoz_client import signoz
    available = await signoz.is_available()
    return {
        "available": available,
        "endpoint": settings.signoz_query_url,
        "service_name": settings.service_name,
    }


@app.get("/signoz/metrics")
async def signoz_metrics():
    """
    Get aggregated metrics from SigNoz for the frontend dashboard.
    Shows: LLM health, healing stats, step performance.
    """
    from backend.signoz_client import signoz

    llm_health = await signoz.get_llm_health()
    healing = await signoz.get_healing_history()
    research_health = await signoz.get_step_health("research")
    code_health = await signoz.get_step_health("code")
    review_health = await signoz.get_step_health("review")

    return {
        "signoz_available": await signoz.is_available(),
        "llm": {
            "avg_latency_ms": llm_health.avg_latency_ms if llm_health else 0,
            "p95_latency_ms": llm_health.p95_latency_ms if llm_health else 0,
            "error_rate": llm_health.error_rate if llm_health else 0,
            "is_degraded": llm_health.is_degraded if llm_health else False,
        },
        "healing": {
            "total_attempts": healing.total_attempts if healing else 0,
            "success_count": healing.success_count if healing else 0,
            "success_rate": healing.success_rate if healing else 0,
        },
        "steps": {
            "research": {
                "avg_latency_ms": research_health.avg_latency_ms if research_health else 0,
                "error_rate": research_health.error_rate if research_health else 0,
                "is_degraded": research_health.is_degraded if research_health else False,
            },
            "code": {
                "avg_latency_ms": code_health.avg_latency_ms if code_health else 0,
                "error_rate": code_health.error_rate if code_health else 0,
                "is_degraded": code_health.is_degraded if code_health else False,
            },
            "review": {
                "avg_latency_ms": review_health.avg_latency_ms if review_health else 0,
                "error_rate": review_health.error_rate if review_health else 0,
                "is_degraded": review_health.is_degraded if review_health else False,
            },
        },
    }


# ── Pipeline ──────────────────────────────────────────────────────────────────

async def _run_pipeline(task_id: str, prompt: str):
    """Full pipeline: coordinate → research → code → review (with Copilot healing)."""
    try:
        _emit(task_id, "status", {"step": "coordinator", "status": "running", "message": "Decomposing task..."})

        # 1. Coordinator
        plan = await coordinator.coordinate(prompt)
        steps = [
            StepInfo(name="research", agent="Researcher"),
            StepInfo(name="code", agent="Coder"),
            StepInfo(name="review", agent="Reviewer"),
        ]
        for s in steps:
            await store.add_step(task_id, s)

        _emit(task_id, "status", {"step": "coordinator", "status": "done", "message": f"Plan: {' → '.join(s['step'] for s in plan)}"})

        # 2. Research (with healing)
        research_output = await _run_step_with_healing(
            task_id, prompt, "research", plan[0]["description"],
            runner=lambda hint: researcher.research(prompt, plan[0]["description"], fix_hint=hint)
        )
        if research_output is None:
            return  # manual mode

        # 3. Code (with healing)
        code_output = await _run_step_with_healing(
            task_id, prompt, "code", plan[1]["description"],
            runner=lambda hint: coder.produce(prompt, plan[1]["description"], research_output, fix_hint=hint)
        )
        if code_output is None:
            return  # manual mode

        # 4. Review
        _emit(task_id, "status", {"step": "review", "status": "running", "message": "Reviewing output quality..."})
        await store.update_step(task_id, "review", status="running")

        review_result = await reviewer.review(prompt, code_output)

        await store.update_step(task_id, "review", status="done",
                                output=f"Score: {review_result.score:.2f} | {review_result.reasoning}",
                                tokens=review_result.tokens, latency_ms=review_result.latency_ms)

        _emit(task_id, "status", {"step": "review", "status": "done",
                                   "message": f"Score: {review_result.score:.2f} — {'Pass' if review_result.passed else 'Fail'}"})

        # Copilot check on review score
        decision = await evaluate(task_id, "review", score=review_result.score)
        _emit_anomaly(task_id, "review", decision)

        if decision.action == "retry":
            # Low score — retry the code step with feedback
            _emit(task_id, "status", {"step": "copilot", "status": "healing",
                                       "message": f"Score too low ({review_result.score:.2f}). Retrying code step..."})

            code_output = await _run_step_with_healing(
                task_id, prompt, "code", plan[1]["description"],
                runner=lambda hint: coder.produce(prompt, plan[1]["description"], research_output, fix_hint=hint),
                initial_hint=decision.fix_hint,
            )
            if code_output is None:
                return

            # Re-review
            review_result = await reviewer.review(prompt, code_output)
            await store.update_step(task_id, "review",
                                    output=f"Score: {review_result.score:.2f} | {review_result.reasoning}",
                                    tokens=review_result.tokens, latency_ms=review_result.latency_ms)

            if review_result.passed:
                await mark_fix_result(task_id, decision.attempt, "success")
            else:
                await mark_fix_result(task_id, decision.attempt, "fail")
                # Check again
                decision2 = await evaluate(task_id, "review", score=review_result.score)
                _emit_anomaly(task_id, "review", decision2)
                if decision2.action == "manual":
                    await _go_manual(task_id, decision2.reason, code_output)
                    return

        elif decision.action == "manual":
            await _go_manual(task_id, decision.reason, code_output)
            return

        # Success!
        ctx = await store.get(task_id)
        total_tokens = sum(s.tokens for s in ctx.steps) if ctx else 0
        await store.update(task_id, status="success", final_output=code_output, total_tokens=total_tokens)
        tasks_completed.add(1)

        _emit(task_id, "complete", {"status": "success", "output_length": len(code_output)})

    except Exception as exc:
        tb = traceback.format_exc()
        await store.update(task_id, status="error", error=str(exc))
        tasks_failed.add(1)
        _emit(task_id, "error", {"error": str(exc), "traceback": tb[:500]})
    finally:
        # Cleanup SSE queue after a delay (let clients read final events)
        await asyncio.sleep(5)
        _event_queues.pop(task_id, None)


async def _run_step_with_healing(
    task_id: str,
    prompt: str,
    step_name: str,
    description: str,
    runner,
    initial_hint: str | None = None,
) -> str | None:
    """
    Run an agent step with Copilot healing. Returns output string, or None if manual mode.
    """
    fix_hint = initial_hint
    max_tries = settings.max_auto_fix_attempts + 1

    for attempt in range(max_tries):
        # Check if task was cancelled
        ctx = await store.get(task_id)
        if ctx and ctx.status == 'cancelled':
            return None

        try:
            _emit(task_id, "status", {
                "step": step_name,
                "status": "running",
                "message": f"{'Retrying' if attempt > 0 else 'Running'} {step_name}...",
                "attempt": attempt + 1,
            })
            await store.update_step(task_id, step_name, status="running")

            resp = await runner(fix_hint)

            await store.update_step(task_id, step_name, status="done",
                                    output=resp.text, tokens=resp.tokens, latency_ms=resp.latency_ms)

            ctx = await store.get(task_id)
            if ctx:
                ctx.total_tokens += resp.tokens

            _emit(task_id, "status", {
                "step": step_name,
                "status": "done",
                "message": f"{step_name.title()} complete ({resp.tokens} tokens, {resp.latency_ms:.0f}ms)",
            })

            # Copilot check
            decision = await evaluate(task_id, step_name)
            _emit_anomaly(task_id, step_name, decision)
            if decision.action == "continue":
                if attempt > 0:
                    await mark_fix_result(task_id, decision.attempt or attempt, "success")
                return resp.text
            elif decision.action == "retry":
                fix_hint = decision.fix_hint
                _emit(task_id, "status", {"step": "copilot", "status": "healing",
                                           "message": f"Copilot: {decision.reason[:100]}. Retrying..."})
                continue
            elif decision.action == "manual":
                await _go_manual(task_id, decision.reason, resp.text)
                return None

        except Exception as exc:
            error_msg = str(exc)
            await store.update_step(task_id, step_name, status="failed", output=f"ERROR: {error_msg}")
            _emit(task_id, "status", {"step": step_name, "status": "failed", "message": error_msg[:150]})

            decision = await evaluate(task_id, step_name, error=error_msg)
            _emit_anomaly(task_id, step_name, decision)
            if decision.action == "retry":
                fix_hint = decision.fix_hint
                _emit(task_id, "status", {"step": "copilot", "status": "healing",
                                           "message": f"Copilot healing: {decision.reason[:80]}"})
                continue
            elif decision.action == "manual":
                await _go_manual(task_id, decision.reason, "")
                return None

    # Exhausted attempts
    await _go_manual(task_id, "All auto-fix attempts exhausted.", "")
    return None


async def _go_manual(task_id: str, reason: str, partial_output: str):
    """Switch to manual mode."""
    await store.update(task_id, mode="manual", status="manual_mode", final_output=partial_output)
    tasks_failed.add(1)
    _emit(task_id, "complete", {
        "status": "manual_mode",
        "reason": reason,
        "message": "Switched to Manual Mode. Developer intervention required.",
    })


def _ctx_to_result(ctx: TaskContext) -> dict[str, Any]:
    return TaskResult(
        task_id=ctx.task_id,
        status=ctx.status,
        prompt=ctx.prompt,
        steps=[s.model_dump() for s in ctx.steps],
        final_output=ctx.final_output,
        total_tokens=ctx.total_tokens,
        retry_count=ctx.retry_count,
        fix_history=[f.model_dump() for f in ctx.fix_history],
        anomalies=[a.model_dump() for a in ctx.anomalies],
        mode=ctx.mode,
        error=ctx.error,
    ).model_dump()


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host=settings.backend_host, port=settings.backend_port, reload=True)
