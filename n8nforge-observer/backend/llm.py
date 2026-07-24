"""
Async LLM client using OpenAI-compatible API (Groq, OpenAI, etc).
Uses httpx directly for true async — no blocking the event loop.
Includes rate-limit-aware retry with exponential backoff.
"""
from __future__ import annotations

import asyncio
import time
import httpx
from backend.config import settings


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
) -> LLMResponse:
    """
    Truly async LLM call with rate-limit awareness.
    Waits for token budget to replenish before sending.
    """
    global _next_allowed_time

    # Wait if we need to respect rate limits
    now = time.time()
    if now < _next_allowed_time:
        wait = _next_allowed_time - now
        await asyncio.sleep(wait)

    url = f"{settings.llm_base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model or settings.llm_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature if temperature is not None else settings.llm_temperature,
    }

    for attempt in range(4):
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0)) as client:
                resp = await client.post(url, json=payload, headers=headers)

            # Check rate limit headers and schedule next call
            remaining_tokens = int(resp.headers.get("x-ratelimit-remaining-tokens", "9999"))
            reset_tokens = resp.headers.get("x-ratelimit-reset-tokens", "0s")
            # Parse reset time like "9.42s" or "1m30s"
            reset_secs = _parse_reset_time(reset_tokens)

            if remaining_tokens < 1000:
                # Low on tokens — wait for reset before next call
                _next_allowed_time = time.time() + reset_secs + 0.5

            if resp.status_code == 429:
                retry_after = _parse_reset_time(resp.headers.get("retry-after", f"{2 ** (attempt + 1)}s"))
                _next_allowed_time = time.time() + retry_after
                await asyncio.sleep(retry_after)
                continue

            resp.raise_for_status()
            latency_ms = (time.perf_counter() - t0) * 1000
            data = resp.json()

            text = data["choices"][0]["message"]["content"] or ""
            usage = data.get("usage", {})
            tokens = usage.get("total_tokens", 0)

            return LLMResponse(text=text, tokens=tokens, latency_ms=latency_ms)

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt < 3:
                await asyncio.sleep(2 ** (attempt + 1))
                continue
            raise
        except (httpx.ReadTimeout, httpx.ConnectTimeout):
            if attempt < 3:
                await asyncio.sleep(3)
                continue
            raise RuntimeError("LLM call timed out after retries")

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
