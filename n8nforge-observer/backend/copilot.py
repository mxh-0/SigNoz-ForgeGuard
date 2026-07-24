"""
SRE Copilot — monitors agent execution and heals failures.

Detects:
  - Low reviewer score (below threshold)
  - Agent errors/exceptions
  - Loop patterns (same output repeated)

Healing:
  - Attempt 1: "reword" — adds failure context, asks agent to retry differently
  - Attempt 2: "rethink" — completely different approach
  - After 2 failed attempts: switches to Manual Mode

All state lives in RAM context. No database.
"""
from __future__ import annotations

from dataclasses import dataclass
from backend.config import settings
from backend.context_store import store, FixAttempt, TaskContext


@dataclass
class HealingDecision:
    action: str  # "continue" | "retry" | "manual"
    fix_hint: str | None = None
    attempt: int = 0
    reason: str = ""


async def evaluate(task_id: str, step_name: str, error: str | None = None, score: float | None = None) -> HealingDecision:
    """
    Called after each agent step. Decides whether to continue, retry, or go manual.
    """
    ctx = await store.get(task_id)
    if not ctx:
        return HealingDecision(action="continue")

    # Already manual — don't intervene
    if ctx.mode == "manual":
        return HealingDecision(action="manual", reason="Already in manual mode.")

    # Detect anomaly
    anomaly = _detect_anomaly(ctx, step_name, error, score)
    if not anomaly:
        return HealingDecision(action="continue")

    # Check if we've hit the cap
    if ctx.retry_count >= settings.max_auto_fix_attempts:
        await store.update(task_id, mode="manual", status="manual_mode")
        return HealingDecision(
            action="manual",
            reason=f"Auto-fix cap reached ({settings.max_auto_fix_attempts} attempts). {anomaly}",
        )

    # Generate fix hint
    attempt = ctx.retry_count + 1
    if attempt == 1:
        fix_hint = (
            f"Previous attempt had an issue: {anomaly}. "
            f"Please retry with more care. Be more thorough and precise. "
            f"Address this specific problem in your output."
        )
    else:
        fix_hint = (
            f"Two attempts have failed. Issue: {anomaly}. "
            f"Take a COMPLETELY DIFFERENT approach. Start fresh, "
            f"use different reasoning, try an alternative strategy."
        )

    # Record the fix attempt
    await store.add_fix(task_id, FixAttempt(
        attempt=attempt,
        strategy="reword" if attempt == 1 else "rethink",
        action=fix_hint[:200],
        result="pending",
    ))

    return HealingDecision(
        action="retry",
        fix_hint=fix_hint,
        attempt=attempt,
        reason=anomaly,
    )


async def mark_fix_result(task_id: str, attempt: int, result: str) -> None:
    """Mark a fix attempt as success or fail."""
    ctx = await store.get(task_id)
    if ctx:
        for fix in ctx.fix_history:
            if fix.attempt == attempt and fix.result == "pending":
                fix.result = result
                break


def _detect_anomaly(ctx: TaskContext, step_name: str, error: str | None, score: float | None) -> str | None:
    """Returns anomaly description or None if everything is fine."""
    # Explicit error
    if error:
        return f"Agent error in '{step_name}': {error[:150]}"

    # Low score from reviewer
    if score is not None and score < settings.semantic_score_threshold:
        return f"Quality score {score:.2f} is below threshold {settings.semantic_score_threshold} in '{step_name}'"

    # Check for empty output (agent produced nothing)
    for s in ctx.steps:
        if s.name == step_name and s.status == "done" and len(s.output.strip()) < 20:
            return f"Agent '{step_name}' produced nearly empty output"

    return None
