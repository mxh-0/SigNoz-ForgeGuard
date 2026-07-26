# I Built an AI Agent System That Reads Its Own SigNoz Traces to Decide Whether to Retry

Most AI agent systems ship bad output and hope the user doesn't notice. I built one that catches its own failures — and uses SigNoz as the brain behind those decisions.

This is the story of building SignozForge Observer: what went wrong, what I figured out, and how SigNoz went from "a thing I export traces to" to the core decision engine of the entire system.

---

## The Problem That Started This

I was experimenting with multi-agent AI pipelines — you give a task to a chain of agents (planner, researcher, coder, reviewer) and they collaborate to produce output. Standard stuff.

Except the output kept being garbage.

Not obviously broken garbage. The kind of garbage that scores 0.82 on a quality rubric, has proper markdown headings, reads confidently, and says absolutely nothing useful. Things like:

> "To fix the broken migration, you would need to determine the database credentials. Contact your database administrator to obtain these parameters. Assuming the issue is a missing column..."

It *described* a process. It didn't *do* anything. And my reviewer agent scored it "passing" because it was well-structured and addressed the topic. The developer only discovers it's useless after reading the entire thing.

I realized: **the quality score isn't the problem. The problem is trusting a single number.**

---

## The Solution: An SRE Copilot With Actual Detection Logic

I added a fifth layer — an SRE Copilot that sits above the 4-agent pipeline and runs 7 independent anomaly detectors on every output:

1. Score too low (obvious)
2. Score passes but the reviewer's own reasoning is negative ("lacks specific details")
3. Placeholder phrases detected ("here is a solution", "your code here", "todo:")
4. **Hedging/vagueness markers** — this is the big one. Phrases like "you would need to", "contact the administrator", "assuming the migration is broken". If 2+ of these appear, the output is flagged regardless of length or score.
5. Code step produced mostly prose with a tiny SQL snippet buried in 2000 words of explanation
6. Output is 80%+ similar to the previous attempt (loop detection)
7. Output doesn't overlap with the original prompt's keywords (off-topic)

When any detector fires, the Copilot doesn't just flag it — it retries with targeted feedback:
- Strike 1 (Reword): "The specific issue was X. Retry with more precision."
- Strike 2 (Rethink): "Take a completely different approach."
- After 2 failures: Manual Mode. Hand the partial output to the developer with an honest explanation.

This worked. The PostgreSQL prompt that used to sail through at 0.82 now gets caught at the code step before it even reaches the reviewer.

---

## Where SigNoz Comes In (And Why It's Not Just a Dashboard)

Initially I added SigNoz the way everyone does: export traces, look at a dashboard, feel good about "having observability." Every agent step became a span. Every LLM call got traced. Nice waterfall diagrams.

Then I realized I was sitting on useful data and ignoring it.

The Copilot was making retry decisions based purely on the current output. But SigNoz already knew:
- How long this step usually takes (is the LLM slow right now?)
- Whether healing has worked historically (what's the success rate?)
- Whether this specific step has been failing a lot recently

So I built `signoz_client.py` — a module that **queries SigNoz's Query Service API** before every healing decision.

### What the Copilot reads from SigNoz:

```python
# Before deciding retry strategy, ask SigNoz:
step_health = await signoz.get_step_health("code")      # avg latency, error rate
llm_health = await signoz.get_llm_health()              # p95 latency, rate limits
healing_history = await signoz.get_healing_history()     # success rate
```

Then it adapts:

```python
if signoz_context.get("llm_degraded"):
    fix_hint += " (LLM latency is elevated — keep responses focused and concise.)"

if signoz_context.get("low_healing_success"):
    fix_hint += f" CRITICAL: Historical success rate is {rate:.0%}. This is your last chance."
```

This turned SigNoz from a passive observer into an active participant in the system's decisions. The Copilot literally gets smarter as more data flows through.

### What gets exported to SigNoz:

Every meaningful action creates a span:

- `agent.coordinator`, `agent.researcher`, `agent.coder`, `agent.reviewer` — with token count, latency
- `llm.call` — with model, tokens, latency, retry count, rate limit status, which agent called it
- `copilot.evaluate` — with the decision (continue/retry/manual), anomaly type, and the SigNoz context that informed it

Custom metrics:

- `signozforge.copilot.anomalies_detected` (by type and step)
- `signozforge.copilot.healing_attempts` vs `healing_successes`
- `signozforge.copilot.manual_mode_triggers`
- `signozforge.llm.latency_ms` (histogram by model and caller)
- `signozforge.llm.errors_total` (by error type: timeout, rate_limit, http)

I can open SigNoz, look at the trace for any task, and see exactly why the Copilot decided to retry, what anomaly it found, and what historical context it had when making that decision. Every `copilot.evaluate` span has attributes like `anomaly_type = vague_answer`, `decision = retry`, `strategy = reword`.

---

## The Technical Setup

**Stack:** FastAPI (Python), React + Vite + Tailwind, Groq LLM (llama-3.3-70b-versatile), OpenTelemetry SDK, SigNoz standalone Docker.

**Instrumentation was straightforward:**

```python
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

trace_exporter = OTLPSpanExporter(
    endpoint=f"{otel_endpoint}/v1/traces",
    headers={"signoz-ingestion-key": ingestion_key},  # for SigNoz Cloud
)
```

SigNoz standalone runs in one Docker command:

```bash
docker run -d --name signoz --privileged \
  -p 3301:8080 -p 4317:4317 -p 4318:4318 \
  signoz/signoz-standalone:latest
```

Within 60 seconds, traces flow and the dashboard is live at localhost:3301.

**The part that took debugging:** Getting the Query Service API to return useful data. The builder query format for `api/v3/query_range` took some experimentation — the filter syntax for traces vs metrics is different, and getting the `aggregateAttribute` shape right for histograms vs counters required a few iterations. I ended up wrapping it all in `signoz_client.py` with graceful fallbacks so the Copilot still works when SigNoz is unavailable.

---

## What I'd Tell My Past Self

**1. Don't trust a single quality score.** A score of 0.82 means nothing if the reviewer's own reasoning says "incomplete." Parse the reasoning, not just the number.

**2. The vagueness detector is worth more than the score.** Catching "you would need to determine" and "contact the administrator" catches 80% of bad outputs that scores miss. It's embarrassingly simple — just string matching — but it works because LLMs use the same hedging patterns every time.

**3. Observability data is an input, not just an output.** The moment I started reading data back from SigNoz instead of just exporting to it, the system got meaningfully better. Historical context makes retry decisions intelligent rather than random.

**4. Two strikes is the right number.** One retry is too few (you miss the "different approach" fix). Three or more wastes tokens on prompts that will never succeed. Two fundamentally different strategies (reword vs rethink) covers the repair space.

**5. Manual mode is a feature, not a failure.** The system telling you "I tried twice and cannot solve this, here's what I attempted" is infinitely better than silently shipping garbage. Developers trust systems that are honest about their limits.

---

## The Result

A developer submits a task. Four agents execute it. The Copilot watches every step. If it's bad — and it catches things a score alone would miss — it repairs automatically. If it can't repair it, it says so. Every decision is traced in SigNoz, and the next decision is informed by what SigNoz saw before.

The frontend shows all of this live: pipeline stepper, anomaly cards, healing attempts, manual mode notices. The developer is never in the dark about what happened.

And in SigNoz, I can trace any task end-to-end, see exactly why the Copilot intervened, check whether healing is actually working over time, and spot LLM degradation before it tanks the whole pipeline.

That's not "observability as a nice-to-have." That's observability as the system's brain.

---

*Built during the SigNoz Hackathon 2025. Stack: Python, FastAPI, React, Groq, OpenTelemetry, SigNoz.*
