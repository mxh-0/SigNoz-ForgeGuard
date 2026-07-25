"""
Async LLM client using OpenAI-compatible API (Groq, OpenAI, etc).
Uses httpx directly for true async — no blocking the event loop.
Includes rate-limit-aware retry with exponential backoff.
All calls are traced via OpenTelemetry and visible in SigNoz.
"""
from __future__ import annotations

import asyncio
import time
import httpx
from backend.config import settings
from backend.instrumentation import (
    start_llm_span, llm_calls_total, llm_errors_total, llm_latency,
)


class LLMResponse:
    def __init__(self, text: str, tokens: int, latency_ms: float):
        self.text = text
        self.tokens = tokens
        self.latency_ms = latency_ms


# Track when we can next make a call (rate limit aware)
_next_allowed_time: float = 0


async def llm_call(
    system: str,
    user: str,
    temperature: float | None = None,
    model: str | None = None,
    caller: str = "unknown",
) -> LLMResponse:
    """
    Truly async LLM call with rate-limit awareness.
    Traced in SigNoz: every call creates a span with model, tokens, latency.
    """
    global _next_allowed_time

    # Wait if we need to respect rate limits
    now = time.time()
    if now < _next_allowed_time:
        wait = _next_allowed_time - now
        await asyncio.sleep(wait)

    used_model = model or settings.llm_model
    url = f"{settings.llm_base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": used_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature if temperature is not None else settings.llm_temperature,
    }

    # Record the call in metrics
    llm_calls_total.add(1, {"llm.model": used_model, "llm.caller": caller})

    # Create a SigNoz trace span for this LLM call
    span = start_llm_span(used_model, caller)

    for attempt in range(4):
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0)) as client:
                resp = await client.post(url, json=payload, headers=headers)

            # Check rate limit headers and schedule next call
            remaining_tokens = int(resp.headers.get("x-ratelimit-remaining-tokens", "9999"))
            reset_tokens = resp.headers.get("x-ratelimit-reset-tokens", "0s")
            reset_secs = _parse_reset_time(reset_tokens)

            if remaining_tokens < 1000:
                _next_allowed_time = time.time() + reset_secs + 0.5

            if resp.status_code == 429:
                retry_after = _parse_reset_time(resp.headers.get("retry-after", f"{2 ** (attempt + 1)}s"))
                _next_allowed_time = time.time() + retry_after
                span.set_attribute("llm.rate_limited", True)
                llm_errors_total.add(1, {"llm.error_type": "rate_limit", "llm.model": used_model})
                await asyncio.sleep(retry_after)
                continue

            resp.raise_for_status()
            latency_ms_val = (time.perf_counter() - t0) * 1000
            data = resp.json()

            text = data["choices"][0]["message"]["content"] or ""
            usage = data.get("usage", {})
            tokens = usage.get("total_tokens", 0)

            # Record in SigNoz
            span.set_attribute("llm.tokens_total", tokens)
            span.set_attribute("llm.tokens_prompt", usage.get("prompt_tokens", 0))
            span.set_attribute("llm.tokens_completion", usage.get("completion_tokens", 0))
            span.set_attribute("llm.latency_ms", latency_ms_val)
            span.set_attribute("llm.attempts", attempt + 1)
            span.end()
            llm_latency.record(latency_ms_val, {"llm.model": used_model, "llm.caller": caller})

            return LLMResponse(text=text, tokens=tokens, latency_ms=latency_ms_val)

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt < 3:
                llm_errors_total.add(1, {"llm.error_type": "rate_limit", "llm.model": used_model})
                await asyncio.sleep(2 ** (attempt + 1))
                continue
            llm_errors_total.add(1, {"llm.error_type": "http_error", "llm.model": used_model})
            span.set_attribute("llm.error", str(e))
            span.end()
            raise
        except (httpx.ReadTimeout, httpx.ConnectTimeout):
            llm_errors_total.add(1, {"llm.error_type": "timeout", "llm.model": used_model})
            if attempt < 3:
                await asyncio.sleep(3)
                continue
            span.set_attribute("llm.error", "timeout_after_retries")
            span.end()
            raise RuntimeError("LLM call timed out after retries")

    span.set_attribute("llm.error", "rate_limited_exhausted")
    span.end()
    raise RuntimeError("LLM call failed after 4 attempts (rate limited)")


def _parse_reset_time(s: str) -> float:
    """Parse Groq reset time strings like '9.42s', '1m30s', or plain numbers."""
    s = s.strip()
    try:
        return float(s)
    except ValueError:
        pass
    total = 0.0
    import re
    m_match = re.search(r"(\d+)m", s)
    s_match = re.search(r"([\d.]+)s", s)
    if m_match:
        total += int(m_match.group(1)) * 60
    if s_match:
        total += float(s_match.group(1))
    return total if total > 0 else 2.0
