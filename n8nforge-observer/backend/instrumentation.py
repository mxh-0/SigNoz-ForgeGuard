"""
OpenTelemetry Instrumentation — Core integration with SigNoz.

This is NOT optional. SigNoz is the Copilot's observability backbone:
  - Custom spans trace every agent step, LLM call, and copilot decision
  - Custom metrics track anomalies, healing, success rates
  - The Copilot queries SigNoz for historical data to make smarter decisions

Exports traces + metrics via OTLP to the SigNoz OTel Collector.
"""
from __future__ import annotations

import os
from functools import lru_cache

from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.resources import Resource, SERVICE_NAME
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.trace import StatusCode


# ── Setup ─────────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def setup_telemetry() -> bool:
    """
    Initialize OpenTelemetry tracing + metrics. Exports to SigNoz via OTLP.
    Supports both SigNoz Cloud (with ingestion key) and self-hosted (no auth).
    Called once at app startup.
    """
    otel_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
    ingestion_key = os.getenv("SIGNOZ_INGESTION_KEY", "")

    # Build headers for SigNoz Cloud authentication
    headers = {}
    if ingestion_key:
        headers["signoz-ingestion-key"] = ingestion_key

    try:
        resource = Resource(attributes={
            SERVICE_NAME: os.getenv("SERVICE_NAME", "signozforge-observer"),
            "deployment.environment": os.getenv("DEPLOYMENT_ENV", "development"),
            "service.version": "2.0.0",
        })

        # Traces
        trace_exporter = OTLPSpanExporter(
            endpoint=f"{otel_endpoint}/v1/traces",
            headers=headers,
        )
        trace_provider = TracerProvider(resource=resource)
        trace_provider.add_span_processor(BatchSpanProcessor(trace_exporter))
        trace.set_tracer_provider(trace_provider)

        # Metrics
        metric_exporter = OTLPMetricExporter(
            endpoint=f"{otel_endpoint}/v1/metrics",
            headers=headers,
        )
        metric_reader = PeriodicExportingMetricReader(metric_exporter, export_interval_millis=10000)
        meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])
        metrics.set_meter_provider(meter_provider)

        # Auto-instrument FastAPI (all HTTP requests) and httpx (LLM calls)
        FastAPIInstrumentor.instrument()
        HTTPXClientInstrumentor().instrument()

        cloud_note = " (SigNoz Cloud)" if ingestion_key else " (self-hosted)"
        print(f"[SigNoz] Telemetry active{cloud_note} -- traces + metrics --> {otel_endpoint}")
        return True

    except Exception as e:
        print(f"[SigNoz] WARNING: Telemetry setup failed: {e}")
        print("[SigNoz] The Copilot will work without historical data from SigNoz.")
        return False


# ── Tracer + Meter (used throughout the app) ──────────────────────────────────

def get_tracer() -> trace.Tracer:
    """Get the main application tracer."""
    return trace.get_tracer("signozforge.observer", "2.0.0")


def get_meter() -> metrics.Meter:
    """Get the main application meter for custom metrics."""
    return metrics.get_meter("signozforge.observer", "2.0.0")


# ── Custom Metrics ────────────────────────────────────────────────────────────

_meter = get_meter()

# Counters
tasks_submitted = _meter.create_counter(
    "signozforge.tasks.submitted",
    description="Total tasks submitted by users",
    unit="1",
)

tasks_completed = _meter.create_counter(
    "signozforge.tasks.completed",
    description="Tasks that completed successfully",
    unit="1",
)

tasks_failed = _meter.create_counter(
    "signozforge.tasks.failed",
    description="Tasks that ended in error or manual mode",
    unit="1",
)

anomalies_detected = _meter.create_counter(
    "signozforge.copilot.anomalies_detected",
    description="Anomalies detected by the SRE Copilot",
    unit="1",
)

healing_attempts = _meter.create_counter(
    "signozforge.copilot.healing_attempts",
    description="Healing attempts triggered by the Copilot",
    unit="1",
)

healing_successes = _meter.create_counter(
    "signozforge.copilot.healing_successes",
    description="Healing attempts that resolved the issue",
    unit="1",
)

manual_mode_triggers = _meter.create_counter(
    "signozforge.copilot.manual_mode_triggers",
    description="Times the Copilot gave up and switched to manual mode",
    unit="1",
)

llm_calls_total = _meter.create_counter(
    "signozforge.llm.calls_total",
    description="Total LLM API calls",
    unit="1",
)

llm_errors_total = _meter.create_counter(
    "signozforge.llm.errors_total",
    description="LLM API call errors (timeouts, rate limits, failures)",
    unit="1",
)

# Histograms
llm_latency = _meter.create_histogram(
    "signozforge.llm.latency_ms",
    description="LLM call latency in milliseconds",
    unit="ms",
)

agent_step_latency = _meter.create_histogram(
    "signozforge.agent.step_latency_ms",
    description="Agent step execution latency",
    unit="ms",
)


# ── Span Helpers ──────────────────────────────────────────────────────────────

def start_agent_span(agent_name: str, task_id: str, prompt_short: str):
    """
    Create a traced span for an agent step.
    Usage:
        with start_agent_span("researcher", task_id, prompt[:50]) as span:
            ...
            span.set_attribute("agent.tokens", 346)
    """
    tracer = get_tracer()
    span = tracer.start_span(
        f"agent.{agent_name}",
        attributes={
            "agent.name": agent_name,
            "task.id": task_id,
            "task.prompt_short": prompt_short[:80],
        },
    )
    return span


def start_copilot_span(action: str, task_id: str, step_name: str):
    """
    Create a traced span for a Copilot evaluation or healing decision.
    Usage:
        with start_copilot_span("evaluate", task_id, "code") as span:
            span.set_attribute("copilot.decision", "retry")
    """
    tracer = get_tracer()
    span = tracer.start_span(
        f"copilot.{action}",
        attributes={
            "copilot.action": action,
            "task.id": task_id,
            "copilot.target_step": step_name,
        },
    )
    return span


def start_llm_span(model: str, agent: str):
    """
    Create a traced span for an LLM call.
    Usage:
        with start_llm_span("llama-3.3-70b", "researcher") as span:
            span.set_attribute("llm.tokens", 500)
    """
    tracer = get_tracer()
    span = tracer.start_span(
        "llm.call",
        attributes={
            "llm.model": model,
            "llm.caller_agent": agent,
        },
    )
    return span


def record_anomaly(anomaly_type: str, step: str, task_id: str):
    """Record an anomaly detection in both metrics and a trace event."""
    anomalies_detected.add(1, {"anomaly.type": anomaly_type, "agent.step": step})


def record_healing(attempt: int, strategy: str, step: str):
    """Record a healing attempt in metrics."""
    healing_attempts.add(1, {"copilot.strategy": strategy, "agent.step": step, "copilot.attempt": attempt})


def record_healing_success(step: str):
    """Record a successful healing in metrics."""
    healing_successes.add(1, {"agent.step": step})


def record_manual_mode(task_id: str):
    """Record a manual mode switch in metrics."""
    manual_mode_triggers.add(1, {"task.id": task_id})
