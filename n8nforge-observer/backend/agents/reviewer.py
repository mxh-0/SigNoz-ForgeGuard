"""
Reviewer — LLM-as-Judge that scores the output quality.
Returns a score 0.0–1.0 and reasoning. This is the signal the Copilot watches.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from backend.llm import llm_call

RUBRIC = """You are an impartial quality judge. Score the output on 5 dimensions (0-20 each):

1. COMPLETENESS — Does it fully address the task?
2. ACCURACY — Is it factually correct?
3. CLARITY — Is it well-structured and easy to follow?
4. DEPTH — Does it provide real insight beyond surface-level?
5. USEFULNESS — Is it actionable and directly usable?

Return ONLY a JSON object:
{
  "completeness": <0-20>,
  "accuracy": <0-20>,
  "clarity": <0-20>,
  "depth": <0-20>,
  "usefulness": <0-20>,
  "total": <0-100>,
  "pass": <true/false>,
  "reasoning": "<1-2 sentence justification>"
}

Pass threshold: total >= 60.
"""


@dataclass
class ReviewResult:
    score: float  # 0.0 - 1.0
    passed: bool
    reasoning: str
    tokens: int
    latency_ms: float


async def review(prompt: str, artifact: str) -> ReviewResult:
    """Score the artifact. Returns structured result with the semantic score."""
    user_msg = (
        f"## Original Task\n{prompt}\n\n"
        f"## Output to Evaluate\n{artifact}\n\n"
        "Score using the rubric. Return only JSON."
    )

    resp = await llm_call(system=RUBRIC, user=user_msg, temperature=0.0)

    # Parse
    match = re.search(r"\{.*\}", resp.text, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group())
            total = data.get("total", 0)
            return ReviewResult(
                score=round(total / 100.0, 3),
                passed=bool(data.get("pass", total >= 60)),
                reasoning=data.get("reasoning", ""),
                tokens=resp.tokens,
                latency_ms=resp.latency_ms,
            )
        except (json.JSONDecodeError, KeyError):
            pass

    # Fallback — couldn't parse, assume fail so Copilot can intervene
    return ReviewResult(
        score=0.0,
        passed=False,
        reasoning="Reviewer failed to produce valid scoring output.",
        tokens=resp.tokens,
        latency_ms=resp.latency_ms,
    )
