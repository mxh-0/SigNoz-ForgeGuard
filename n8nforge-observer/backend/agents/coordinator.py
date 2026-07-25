"""
Coordinator — decomposes the task into steps and assigns agents.
"""
from __future__ import annotations

import json
import re

from backend.llm import llm_call

SYSTEM = """You are a task coordinator. Given a user task, decompose it into exactly 3 steps:
1. research — gather relevant information
2. code — produce the output artifact (report, code, analysis, etc.)
3. review — evaluate quality

Return ONLY a JSON array like:
[
  {"step": "research", "description": "...what to research..."},
  {"step": "code", "description": "...what to produce..."},
  {"step": "review", "description": "...what to check..."}
]
"""


async def coordinate(prompt: str, fix_hint: str | None = None) -> list[dict]:
    """Return a 3-step plan. Always succeeds with fallback."""
    user_msg = f"Task: {prompt}"
    if fix_hint:
        user_msg += f"\n\nPrevious attempt failed. Copilot says: {fix_hint}"

    resp = await llm_call(system=SYSTEM, user=user_msg, temperature=0.1, caller="coordinator")

    # Parse
    match = re.search(r"\[.*\]", resp.text, re.DOTALL)
    if match:
        try:
            plan = json.loads(match.group())
            if len(plan) >= 3:
                return plan[:3]
        except json.JSONDecodeError:
            pass

    # Fallback
    return [
        {"step": "research", "description": f"Research information needed for: {prompt[:100]}"},
        {"step": "code", "description": f"Produce the output for: {prompt[:100]}"},
        {"step": "review", "description": "Evaluate completeness and accuracy of the output"},
    ]
