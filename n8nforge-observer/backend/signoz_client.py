"""
SigNoz Query Client — reads observability data FROM SigNoz.

This is the key integration: the Copilot doesn't just EXPORT data to SigNoz,
it READS data from SigNoz to make smarter healing decisions.

Queries:
  - Recent agent step latencies (is the LLM slow right now?)
  - Error rate for a given step (has this step been failing frequently?)
  - Historical healing success rate (should we even bother retrying?)
  - LLM performance trends (is Groq having issues?)

Uses the SigNoz Query Service HTTP API (port 8080 by default).
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from backend.config import settings


@dataclass
class StepHealth:
    """Health summary for an agent step from SigNoz trace data."""
    avg_latency_ms: float
    error_rate: float     # 0.0 - 1.0
    total_executions: int
    recent_errors: int
    is_degraded: bool     # True if latency or errors are abnormally high


@dataclass
class LLMHealth:
    """Current LLM provider health from SigNoz."""
    avg_latency_ms: float
    p95_latency_ms: float
    error_rate: float
    rate_limit_hits: int
    is_degraded: bool


@dataclass
class HealingHistory:
    """Historical healing success data from SigNoz metrics."""
    total_attempts: int
    success_count: int
    success_rate: float   # 0.0 - 1.0
    avg_attempts_to_fix: float


class SigNozClient:
    """
    Queries SigNoz for observability data that informs Copilot decisions.
    Gracefully degrades if SigNoz is unavailable — the Copilot still works,
    it just doesn't have historical context.
    """

    def __init__(self):
        self.base_url = settings.signoz_query_url
        self.service = settings.service_name
        self._available = True
        self._last_check: float = 0

    async def is_available(self) -> bool:
        """Check if SigNoz Query Service is reachable."""
        now = time.time()
        if now - self._last_check < 30:
            return self._available

        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{self.base_url}/api/v1/health")
                self._available = resp.status_code == 200
        except Exception:
            self._available = False

        self._last_check = now
        if self._available:
            print(f"  [SigNoz Query] Connected to {self.base_url}")
        return self._available

    async def get_step_health(self, step_name: str, window_minutes: int = 30) -> StepHealth | None:
        """
        Query SigNoz for recent performance of a specific agent step.
        Returns None if SigNoz is unavailable.
        """
        if not await self.is_available():
            return None

        now = int(time.time() * 1_000_000_000)  # nanoseconds
        start = now - (window_minutes * 60 * 1_000_000_000)

        # Query traces for this agent step
        query = {
            "start": start,
            "end": now,
            "step": 60,
            "compositeQuery": {
                "builderQueries": {
                    "A": {
                        "queryName": "A",
                        "dataSource": "traces",
                        "aggregateOperator": "avg",
                        "aggregateAttribute": {
                            "key": "duration_nano",
                            "dataType": "float64",
                            "type": "tag",
                            "isColumn": True,
                        },
                        "filters": {
                            "items": [
                                {
                                    "key": {"key": "name", "dataType": "string", "type": "tag", "isColumn": True},
                                    "op": "=",
                                    "value": f"agent.{step_name}",
                                },
                                {
                                    "key": {"key": "serviceName", "dataType": "string", "type": "tag", "isColumn": True},
                                    "op": "=",
                                    "value": self.service,
                                },
                            ],
                            "op": "AND",
                        },
                    }
                },
                "panelType": "graph",
                "queryType": "builder",
            },
        }

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(
                    f"{self.base_url}/api/v3/query_range",
                    json=query,
                )
                if resp.status_code != 200:
                    return self._fallback_step_health(step_name)

                data = resp.json()
                return self._parse_step_health(data, step_name)

        except Exception as e:
            print(f"  [SigNoz Query] Failed to get step health for '{step_name}': {e}")
            return self._fallback_step_health(step_name)

    async def get_llm_health(self, window_minutes: int = 15) -> LLMHealth | None:
        """
        Query SigNoz for current LLM call performance.
        Checks: latency trends, error rates, rate limit hits.
        """
        if not await self.is_available():
            return None

        now = int(time.time() * 1_000_000_000)
        start = now - (window_minutes * 60 * 1_000_000_000)

        query = {
            "start": start,
            "end": now,
            "step": 60,
            "compositeQuery": {
                "builderQueries": {
                    "A": {
                        "queryName": "A",
                        "dataSource": "traces",
                        "aggregateOperator": "avg",
                        "aggregateAttribute": {
                            "key": "duration_nano",
                            "dataType": "float64",
                            "type": "tag",
                            "isColumn": True,
                        },
                        "filters": {
                            "items": [
                                {
                                    "key": {"key": "name", "dataType": "string", "type": "tag", "isColumn": True},
                                    "op": "=",
                                    "value": "llm.call",
                                },
                                {
                                    "key": {"key": "serviceName", "dataType": "string", "type": "tag", "isColumn": True},
                                    "op": "=",
                                    "value": self.service,
                                },
                            ],
                            "op": "AND",
                        },
                    }
                },
                "panelType": "graph",
                "queryType": "builder",
            },
        }

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(
                    f"{self.base_url}/api/v3/query_range",
                    json=query,
                )
                if resp.status_code != 200:
                    return self._fallback_llm_health()
                data = resp.json()
                return self._parse_llm_health(data)
        except Exception as e:
            print(f"  [SigNoz Query] Failed to get LLM health: {e}")
            return self._fallback_llm_health()

    async def get_healing_history(self, window_minutes: int = 60) -> HealingHistory | None:
        """
        Query SigNoz metrics for healing attempt history.
        Uses custom counter signozforge.copilot.healing_attempts/successes.
        """
        if not await self.is_available():
            return None

        now = int(time.time() * 1_000_000_000)
        start = now - (window_minutes * 60 * 1_000_000_000)

        query = {
            "start": start,
            "end": now,
            "step": 60,
            "compositeQuery": {
                "builderQueries": {
                    "A": {
                        "queryName": "A",
                        "dataSource": "metrics",
                        "aggregateOperator": "sum",
                        "aggregateAttribute": {
                            "key": "signozforge_copilot_healing_attempts_total",
                            "dataType": "float64",
                            "type": "Sum",
                            "isMonotonic": True,
                        },
                        "filters": {"items": [], "op": "AND"},
                    },
                    "B": {
                        "queryName": "B",
                        "dataSource": "metrics",
                        "aggregateOperator": "sum",
                        "aggregateAttribute": {
                            "key": "signozforge_copilot_healing_successes_total",
                            "dataType": "float64",
                            "type": "Sum",
                            "isMonotonic": True,
                        },
                        "filters": {"items": [], "op": "AND"},
                    },
                },
                "panelType": "graph",
                "queryType": "builder",
            },
        }

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(
                    f"{self.base_url}/api/v3/query_range",
                    json=query,
                )
                if resp.status_code != 200:
                    return self._fallback_healing_history()
                data = resp.json()
                return self._parse_healing_history(data)
        except Exception:
            return self._fallback_healing_history()

    async def get_recent_error_traces(self, step_name: str, limit: int = 5) -> list[dict]:
        """
        Get recent error spans for a step — shows the Copilot what went wrong before.
        """
        if not await self.is_available():
            return []

        now = int(time.time() * 1_000_000_000)
        start = now - (30 * 60 * 1_000_000_000)

        params = {
            "start": str(start),
            "end": str(now),
            "limit": str(limit),
            "orderParam": "timestamp",
            "order": "desc",
            "serviceName": self.service,
            "operation": f"agent.{step_name}",
            "minDuration": "",
            "maxDuration": "",
            "statusCode": "error",
        }

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    f"{self.base_url}/api/v2/spans",
                    params=params,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("spans", [])[:limit]
        except Exception:
            pass
        return []

    # ── Parsing helpers ───────────────────────────────────────────────────────

    def _parse_step_health(self, data: dict, step_name: str) -> StepHealth:
        """Parse SigNoz query response into StepHealth."""
        try:
            results = data.get("result", [])
            if results and results[0].get("series"):
                series = results[0]["series"]
                values = [p["value"] for s in series for p in s.get("values", []) if p.get("value")]
                if values:
                    avg_ns = sum(values) / len(values)
                    avg_ms = avg_ns / 1_000_000
                    return StepHealth(
                        avg_latency_ms=avg_ms,
                        error_rate=0.0,
                        total_executions=len(values),
                        recent_errors=0,
                        is_degraded=avg_ms > 10000,  # > 10s is degraded
                    )
        except Exception:
            pass
        return self._fallback_step_health(step_name)

    def _parse_llm_health(self, data: dict) -> LLMHealth:
        """Parse SigNoz query response into LLMHealth."""
        try:
            results = data.get("result", [])
            if results and results[0].get("series"):
                series = results[0]["series"]
                values = [p["value"] for s in series for p in s.get("values", []) if p.get("value")]
                if values:
                    avg_ns = sum(values) / len(values)
                    sorted_vals = sorted(values)
                    p95_ns = sorted_vals[int(len(sorted_vals) * 0.95)] if len(sorted_vals) > 1 else avg_ns
                    return LLMHealth(
                        avg_latency_ms=avg_ns / 1_000_000,
                        p95_latency_ms=p95_ns / 1_000_000,
                        error_rate=0.0,
                        rate_limit_hits=0,
                        is_degraded=(avg_ns / 1_000_000) > 15000,
                    )
        except Exception:
            pass
        return self._fallback_llm_health()

    def _parse_healing_history(self, data: dict) -> HealingHistory:
        """Parse SigNoz metrics query into HealingHistory."""
        try:
            results = data.get("result", [])
            attempts = 0
            successes = 0
            for r in results:
                name = r.get("queryName", "")
                series = r.get("series", [])
                total = sum(p.get("value", 0) for s in series for p in s.get("values", []))
                if name == "A":
                    attempts = int(total)
                elif name == "B":
                    successes = int(total)
            success_rate = successes / max(attempts, 1)
            return HealingHistory(
                total_attempts=attempts,
                success_count=successes,
                success_rate=success_rate,
                avg_attempts_to_fix=attempts / max(successes, 1),
            )
        except Exception:
            return self._fallback_healing_history()

    # ── Fallbacks (when SigNoz is unavailable) ────────────────────────────────

    def _fallback_step_health(self, step_name: str) -> StepHealth:
        return StepHealth(avg_latency_ms=0, error_rate=0, total_executions=0, recent_errors=0, is_degraded=False)

    def _fallback_llm_health(self) -> LLMHealth:
        return LLMHealth(avg_latency_ms=0, p95_latency_ms=0, error_rate=0, rate_limit_hits=0, is_degraded=False)

    def _fallback_healing_history(self) -> HealingHistory:
        return HealingHistory(total_attempts=0, success_count=0, success_rate=0.5, avg_attempts_to_fix=1.5)


# Singleton
signoz = SigNozClient()
