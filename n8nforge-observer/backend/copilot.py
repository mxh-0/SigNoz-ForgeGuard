"""
SRE Copilot — monitors agent execution and heals failures.

Detects:
  - Low reviewer score (below threshold)
  - Agent errors/exceptions
  - Loop patterns (same output repeated)
  - Placeholder/generic text
  - Incomplete code blocks
  - Off-topic answers

Healing:
  - Attempt 1: "reword" — adds failure context, asks agent to retry differently
  - Attempt 2: "rethink" — completely different approach
  - After 2 failed attempts: switches to Manual Mode

All state lives in RAM context. No database.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from dataclasses import dataclass
from backend.config import settings
from backend.context_store import store, FixAttempt, TaskContext, AnomalyEvent
from backend.signoz_client import signoz
from backend.instrumentation import (
    record_anomaly, record_healing, record_healing_success, record_manual_mode,
    start_copilot_span, anomalies_detected, healing_attempts as healing_attempts_metric,
)


# Per-task, per-step output history for loop detection.
# Key: f"{task_id}:{step_name}" -> list of previous outputs.
# Lives in RAM only, cleared implicitly when the task is cleared.
_output_history: dict[str, list[str]] = {}

# Copilot demands a genuinely good answer, not just a "passing" one.
# The reviewer's own pass mark (0.6) is far too lenient — an answer that
# "lacks specific details" can still score 0.82. This is the real bar.
STRICT_SCORE_FLOOR = 0.88

# Phrases the reviewer uses when it is quietly telling us the answer is weak.
# If these appear in the reviewer's reasoning, the score alone cannot be trusted.
CRITIQUE_MARKERS = [
    "lacks", "lacking", "missing", "incomplete", "not complete",
    "prevents it from", "fails to", "does not fully", "doesn't fully",
    "does not actually", "not actionable", "no specific", "without specific",
    "requires further", "needs further", "insufficient", "limited detail",
    "too generic", "generic", "vague", "superficial", "surface-level",
    "unclear", "placeholder", "hypothetical", "not directly usable",
    "would need to", "no concrete", "lacks specificity",
]

# Hedging language that signals the model described a process instead of
# actually solving the task.
VAGUENESS_MARKERS = [
    "requires further investigation",
    "unknown (requires",
    "needs to be determined",
    "can be obtained by",
    "contact the database administrator",
    "contacting the database administrator",
    "consult your",
    "you would need to",
    "you will need to",
    "depends on your",
    "in a real scenario",
    "in a real-world scenario",
    "assuming the",
    "assuming that",
    "with the actual",
    "replace the",
    "this is just an example",
    "for illustration",
    "for demonstration purposes",
    "left as an exercise",
    "beyond the scope",
    "cannot be determined",
    "further analysis is needed",
]


def _ts() -> str:
    """Compact timestamp for logs."""
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def _log_anomaly(step: str, msg: str) -> None:
    """Print a highly visible anomaly detection message for demo recording."""
    print("")
    print("=" * 70)
    print(f"  [ANOMALY DETECTED]  [{_ts()}]")
    print(f"  Step: {step}")
    print(f"  Issue: {msg}")
    print("=" * 70)
    print("")


def _log_healing(attempt: int, strategy: str, step: str) -> None:
    """Print when the copilot starts a healing attempt."""
    print("")
    print("+" * 70)
    print(f"  [COPILOT HEALING] Attempt {attempt}  [{_ts()}]")
    print(f"  Strategy: {strategy.upper()}")
    print(f"  Target step: {step}")
    print("+" * 70)
    print("")


def _log_manual_mode(reason: str) -> None:
    """Print when switching to manual mode."""
    print("")
    print("!" * 70)
    print(f"  [MANUAL MODE ACTIVATED]  [{_ts()}]")
    print(f"  Reason: {reason}")
    print(f"  Action: Developer intervention required")
    print("!" * 70)
    print("")


def _log_ok(step: str, detail: str = "") -> None:
    """Print when no anomaly is detected."""
    extra = f" ({detail})" if detail else ""
    print(f"  [COPILOT {_ts()}] No anomaly in '{step}'{extra} -- continuing")


def _flag(ctx: TaskContext, step: str, kind: str, msg: str) -> str:
    """
    Log the anomaly AND record it on the RAM context so the frontend can show it.
    Returns the message so callers can `return _flag(...)`.
    """
    _log_anomaly(step, msg)
    try:
        ctx.anomalies.append(AnomalyEvent(step=step, kind=kind, detail=msg))
    except Exception:
        # Never let telemetry bookkeeping break the pipeline
        pass
    return msg


@dataclass
class HealingDecision:
    action: str  # "continue" | "retry" | "manual"
    fix_hint: str | None = None
    attempt: int = 0
    reason: str = ""


async def evaluate(task_id: str, step_name: str, error: str | None = None, score: float | None = None) -> HealingDecision:
    """
    Called after each agent step. Decides whether to continue, retry, or go manual.
    Queries SigNoz for historical data to inform the decision.
    """
    ctx = await store.get(task_id)
    if not ctx:
        return HealingDecision(action="continue")

    # Already manual — don't intervene
    if ctx.mode == "manual":
        return HealingDecision(action="manual", reason="Already in manual mode.")

    # Start a traced span so this decision shows up in SigNoz
    span = start_copilot_span("evaluate", task_id, step_name)
    try:
        # Detect anomaly
        anomaly = _detect_anomaly(ctx, step_name, error, score)
        if not anomaly:
            span.set_attribute("copilot.decision", "continue")
            span.end()
            return HealingDecision(action="continue")

        # Record anomaly in SigNoz metrics
        anomaly_kind = ctx.anomalies[-1].kind if ctx.anomalies else "unknown"
        record_anomaly(anomaly_kind, step_name, task_id)
        span.set_attribute("copilot.anomaly_detected", True)
        span.set_attribute("copilot.anomaly_type", anomaly_kind)

        # Check if we've hit the cap
        if ctx.retry_count >= settings.max_auto_fix_attempts:
            await store.update(task_id, mode="manual", status="manual_mode")
            reason = f"Auto-fix cap reached ({settings.max_auto_fix_attempts} attempts). {anomaly}"
            _log_manual_mode(reason)
            record_manual_mode(task_id)
            span.set_attribute("copilot.decision", "manual")
            span.end()
            return HealingDecision(action="manual", reason=reason)

        # ── Query SigNoz for smarter retry strategy ───────────────────────────
        signoz_context = await _get_signoz_context(step_name)

        # Generate fix hint — enhanced with SigNoz historical data
        attempt = ctx.retry_count + 1
        strategy = "reword" if attempt == 1 else "rethink"

        if attempt == 1:
            fix_hint = (
                f"Previous attempt had an issue: {anomaly}. "
                f"Please retry with more care. Be more thorough and precise. "
                f"Address this specific problem in your output."
            )
            # If SigNoz shows this step is historically problematic, be more aggressive
            if signoz_context.get("step_degraded"):
                fix_hint += (
                    f" NOTE: SigNoz data shows this step has been unreliable "
                    f"(error rate: {signoz_context.get('error_rate', 0):.0%}). "
                    f"Take extra care to produce a complete, non-generic answer."
                )
        else:
            fix_hint = (
                f"Two attempts have failed. Issue: {anomaly}. "
                f"Take a COMPLETELY DIFFERENT approach. Start fresh, "
                f"use different reasoning, try an alternative strategy."
            )
            # If SigNoz shows healing rarely works, hint at the reality
            if signoz_context.get("low_healing_success"):
                fix_hint += (
                    f" CRITICAL: Historical data shows a {signoz_context.get('healing_success_rate', 0):.0%} "
                    f"healing success rate. This is your last chance before manual mode."
                )

        # If LLM is degraded, note it
        if signoz_context.get("llm_degraded"):
            fix_hint += " (LLM latency is currently elevated — keep responses focused and concise.)"

        _log_healing(attempt, strategy, step_name)
        record_healing(attempt, strategy, step_name)

        # Record the fix attempt
        await store.add_fix(task_id, FixAttempt(
            attempt=attempt,
            strategy=strategy,
            action=fix_hint[:200],
            result="pending",
        ))

        span.set_attribute("copilot.decision", "retry")
        span.set_attribute("copilot.attempt", attempt)
        span.set_attribute("copilot.strategy", strategy)
        span.set_attribute("copilot.signoz_context", str(signoz_context))
        span.end()

        return HealingDecision(
            action="retry",
            fix_hint=fix_hint,
            attempt=attempt,
            reason=anomaly,
        )
    except Exception as e:
        span.set_attribute("copilot.error", str(e))
        span.end()
        raise


async def _get_signoz_context(step_name: str) -> dict:
    """
    Query SigNoz for historical performance data to guide healing decisions.
    Returns a dict with context flags. Gracefully returns empty dict if unavailable.
    """
    context = {}
    try:
        # Check step health
        step_health = await signoz.get_step_health(step_name)
        if step_health:
            context["step_latency_ms"] = step_health.avg_latency_ms
            context["step_error_rate"] = step_health.error_rate
            context["step_executions"] = step_health.total_executions
            context["step_degraded"] = step_health.is_degraded
            context["error_rate"] = step_health.error_rate
            if step_health.is_degraded:
                print(f"  [SigNoz] Step '{step_name}' is degraded: avg {step_health.avg_latency_ms:.0f}ms")

        # Check LLM health
        llm_health = await signoz.get_llm_health()
        if llm_health:
            context["llm_latency_ms"] = llm_health.avg_latency_ms
            context["llm_degraded"] = llm_health.is_degraded
            if llm_health.is_degraded:
                print(f"  [SigNoz] LLM is degraded: avg {llm_health.avg_latency_ms:.0f}ms, p95 {llm_health.p95_latency_ms:.0f}ms")

        # Check healing history
        healing_history = await signoz.get_healing_history()
        if healing_history and healing_history.total_attempts > 0:
            context["healing_success_rate"] = healing_history.success_rate
            context["low_healing_success"] = healing_history.success_rate < 0.3
            context["healing_total"] = healing_history.total_attempts

    except Exception as e:
        print(f"  [SigNoz] Context query failed (non-fatal): {e}")

    return context


async def mark_fix_result(task_id: str, attempt: int, result: str) -> None:
    """Mark a fix attempt as success or fail. Records in SigNoz metrics."""
    ctx = await store.get(task_id)
    if ctx:
        for fix in ctx.fix_history:
            if fix.attempt == attempt and fix.result == "pending":
                fix.result = result
                if result == "success":
                    record_healing_success(fix.strategy)
                break


def _detect_anomaly(ctx: TaskContext, step_name: str, error: str | None, score: float | None) -> str | None:
    """
    Returns an anomaly description or None if everything is fine.
    Aggressive detection: errors, low scores, empty output, placeholder/generic text,
    incomplete code, loop patterns (same output repeated), and off-topic answers.
    """
    # 1. Explicit exception from the agent runner
    if error:
        return _flag(ctx, step_name, "agent_error",
                     f"Agent error in '{step_name}': {error[:150]}")

    # ── Score-based path (the review step) ────────────────────────────────────
    if score is not None:
        # 2a. Below the configured pass threshold — hard fail
        if score < settings.semantic_score_threshold:
            return _flag(ctx, step_name, "low_score",
                         f"Quality score {score:.2f} is below pass threshold "
                         f"{settings.semantic_score_threshold}")

        # 2b. Below the Copilot's strict bar — "passing" is not "good"
        if score < STRICT_SCORE_FLOOR:
            return _flag(ctx, step_name, "weak_score",
                         f"Quality score {score:.2f} is below the Copilot strict bar "
                         f"{STRICT_SCORE_FLOOR} — answer is not strong enough")

        # 2c. Reviewer scored it high but its own reasoning is critical.
        # This catches "0.82 but it lacks specific details and isn't useful".
        review_reasoning = ""
        for s in ctx.steps:
            if s.name == "review" and s.output:
                review_reasoning = s.output.split("|", 1)[-1].lower()
                break
        hits = [m for m in CRITIQUE_MARKERS if m in review_reasoning]
        if hits:
            return _flag(ctx, step_name, "reviewer_critique",
                         f"Reviewer scored {score:.2f} but flagged problems: {hits[:4]}")

        _log_ok(step_name, f"score {score:.2f}")
        return None

    # Grab the current output for this step
    current_output = ""
    for s in ctx.steps:
        if s.name == step_name and s.status == "done":
            current_output = s.output
            break

    stripped = current_output.strip()
    lower_out = stripped.lower()

    # 3. Empty / near-empty output (stricter: 50 chars)
    if len(stripped) < 50:
        return _flag(ctx, step_name, "empty_output",
                     f"Agent '{step_name}' produced nearly empty output ({len(stripped)} chars)")

    # 4. Placeholder / generic filler text
    placeholder_phrases = [
        "here is a solution",
        "here's a solution",
        "here is my solution",
        "here is an example",
        "here's an example",
        "this is a sample implementation",
        "this is a sample",
        "sample implementation",
        "as an ai model",
        "as an ai language model",
        "as a large language model",
        "i am an ai",
        "i'm an ai",
        "i cannot",
        "i can't help",
        "placeholder",
        "your code here",
        "insert code here",
        "todo:",
        "todo ",
        "fixme",
        "not implemented",
        "implementation goes here",
        "example only",
        "hypothetical example",
    ]
    found_placeholders = [p for p in placeholder_phrases if p in lower_out]
    if found_placeholders and len(stripped) < 400:
        return _flag(ctx, step_name, "placeholder",
                     f"Placeholder/generic text in '{step_name}' "
                     f"(short output {len(stripped)} chars, markers: {found_placeholders[:3]})")
    # Any placeholder marker is a problem regardless of how long the output is —
    # padding a stub with prose does not make it a solution.
    if found_placeholders:
        return _flag(ctx, step_name, "placeholder",
                     f"Placeholder phrases in '{step_name}': {found_placeholders[:3]}")

    # 4b. Hedging / process-description instead of an actual solution.
    # This is what catches "you would need to determine the credentials,
    # assuming the migration is broken, replace X with the actual value".
    found_vague = [m for m in VAGUENESS_MARKERS if m in lower_out]
    if len(found_vague) >= 2:
        return _flag(ctx, step_name, "vague_answer",
                     f"Output in '{step_name}' describes a process instead of solving the task "
                     f"({len(found_vague)} hedging markers: {found_vague[:3]})")

    # 5. Very short / incomplete code blocks (mainly for the coder step)
    if step_name == "code":
        fence_count = stripped.count("```")
        code_blocks = re.findall(r"```[a-zA-Z0-9_+-]*\n?(.*?)```", stripped, re.DOTALL)
        if code_blocks:
            total_code_length = sum(len(cb.strip()) for cb in code_blocks)
            if total_code_length < 80:
                return _flag(ctx, step_name, "short_code",
                             f"Very short code output: {total_code_length} chars "
                             f"across {len(code_blocks)} block(s)")
            if fence_count % 2 != 0:
                return _flag(ctx, step_name, "unclosed_code",
                             f"Incomplete/unclosed code block (odd fence count {fence_count})")

            # 5b. Mostly prose with a token code snippet buried in it.
            # A "solution" that is 95% explanation and 5% SQL is not a solution.
            code_ratio = total_code_length / max(len(stripped), 1)
            if code_ratio < 0.15:
                return _flag(ctx, step_name, "prose_not_code",
                             f"Output is mostly prose, not code "
                             f"({code_ratio:.0%} code — {total_code_length} of {len(stripped)} chars)")
        else:
            # Coder produced no fenced blocks — check if it at least looks like code
            has_code_markers = any(
                m in stripped
                for m in ("def ", "class ", "function ", "const ", "let ", "var ", "import ", "from ", "return ", "=>", "=", "{", "}")
            )
            if not has_code_markers or len(stripped) < 200:
                return _flag(ctx, step_name, "no_code",
                             f"Code step produced no meaningful code artifacts "
                             f"(no fences, len={len(stripped)})")

    # 6. Loop detection — compare current output with previous outputs of same step
    history_key = f"{ctx.task_id}:{step_name}"
    prev_outputs = _output_history.get(history_key, [])
    if prev_outputs:
        last = prev_outputs[-1]
        similarity = max(_similarity(stripped, p) for p in prev_outputs)
        if similarity >= 0.80:
            _output_history[history_key] = prev_outputs + [stripped]
            return _flag(ctx, step_name, "loop",
                         f"Loop detected: output is {similarity:.0%} similar to a previous "
                         f"attempt (retry {len(prev_outputs)}) — agent is not making progress")
    _output_history[history_key] = prev_outputs + [stripped]

    # 7. Off-topic / doesn't solve the task — keyword overlap heuristic.
    # Applied at any length: a long answer can still miss the point entirely.
    if True:
        stopwords = {
            "the", "and", "for", "this", "that", "with", "from", "have", "will",
            "your", "make", "build", "create", "write", "give", "help", "need",
            "want", "using", "some", "what", "how", "why", "when", "which",
            "were", "been", "them", "they", "then", "than", "into", "about",
            "would", "could", "should", "there", "their", "these", "those",
            "also", "just", "very", "more", "less", "such", "please", "code",
        }
        prompt_words = {
            w for w in re.findall(r"[a-zA-Z]{4,}", ctx.prompt.lower())
            if w not in stopwords
        }
        content_words = {
            w for w in re.findall(r"[a-zA-Z]{4,}", lower_out)
            if w not in stopwords
        }
        if prompt_words:
            overlap = prompt_words & content_words
            overlap_ratio = len(overlap) / len(prompt_words)
            # Short answers are held to a higher overlap bar than long ones.
            min_overlap = 0.35 if len(stripped) < 500 else 0.20
            if overlap_ratio < min_overlap:
                return _flag(ctx, step_name, "off_topic",
                             f"Output does not address the prompt "
                             f"({overlap_ratio:.0%} keyword overlap, need {min_overlap:.0%})")

    _log_ok(step_name)
    return None


def _similarity(a: str, b: str) -> float:
    """Jaccard similarity on word tokens. Cheap and good enough for loop detection."""
    if not a or not b:
        return 0.0
    ta = set(a.lower().split())
    tb = set(b.lower().split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)
