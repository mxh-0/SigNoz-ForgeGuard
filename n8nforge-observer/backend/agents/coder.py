"""
Coder — produces the primary output artifact based on research findings.
"""
from __future__ import annotations

from backend.llm import llm_call, LLMResponse

SYSTEM = """You are an output producer. Based on the research, create the final deliverable.
Be comprehensive but efficient — aim for 200-400 words.
Structure with clear headings. Include a brief conclusion."""


async def produce(
    prompt: str,
    plan_description: str,
    research_output: str,
    fix_hint: str | None = None,
) -> LLMResponse:
    """Produce the main artifact. Returns full LLMResponse."""
    user_msg = (
        f"## Original Task\n{prompt}\n\n"
        f"## What to produce\n{plan_description}\n\n"
        f"## Research Findings\n{research_output}\n"
    )
    if fix_hint:
        user_msg += (
            f"\n## Copilot Fix Instruction\n{fix_hint}\n"
            "Apply the above feedback to improve your output significantly."
        )

    temp = 0.2 if fix_hint else 0.3
    return await llm_call(system=SYSTEM, user=user_msg, temperature=temp, caller="coder")
