"""
Researcher — gathers information relevant to the task.
"""
from __future__ import annotations

from backend.llm import llm_call, LLMResponse

SYSTEM = """You are a research agent. Gather key information for the task.
Be concise — max 200 words. Focus on facts, not filler.
Use bullet points. End with 2-3 key takeaways."""


async def research(prompt: str, plan_description: str, fix_hint: str | None = None) -> LLMResponse:
    """Perform research. Returns full LLMResponse with text, tokens, latency."""
    user_msg = f"Task: {prompt}\n\nResearch focus: {plan_description}"
    if fix_hint:
        user_msg += f"\n\nCopilot fix instruction: {fix_hint}\nImprove your research based on this feedback."

    return await llm_call(system=SYSTEM, user=user_msg, temperature=0.4, caller="researcher")
