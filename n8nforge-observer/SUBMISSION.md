# Hackathon Submission Answers

---

## Project Description

SignozForge Observer is a self-healing multi-agent AI system where an SRE Copilot monitors a 4-agent pipeline (Coordinator, Researcher, Coder, Reviewer), detects bad output using 7 independent anomaly detectors, and repairs failures automatically with a 2-strike healing path. SigNoz serves as the Copilot's observability backbone — not just receiving traces and metrics, but feeding historical performance data back into healing decisions. The system catches confident-sounding garbage (placeholder text, hedging language, off-topic answers, loop patterns) that would pass a typical quality score, and either fixes it or honestly escalates to the developer. Built with FastAPI, React, Groq LLM, and OpenTelemetry.

---

## GitHub Link

(paste your repo URL here)

---

## Deployed Link

(paste your Vercel URL here)

---

## YouTube Video Demo Link

(paste your YouTube URL here)

---

## Describe How You Have Used SigNoz in Your Project

SigNoz is used bidirectionally — both as a telemetry destination and as a data source for the Copilot's decision-making.

**EXPORT:** Every agent step (agent.coordinator, agent.researcher, agent.coder, agent.reviewer), every LLM call (llm.call with model, tokens, latency), and every Copilot decision (copilot.evaluate with anomaly_type, strategy, outcome) is traced. 11 custom metrics are exported: task counters, anomaly counts by type, healing attempts vs successes, manual mode triggers, LLM latency histograms, and LLM error breakdowns.

**READ-BACK:** Before deciding how to retry a failed step, the Copilot queries SigNoz Query Service API for: (1) step health — avg latency and error rate over the last 30 min, (2) LLM provider health — p95 latency and rate limit hits, (3) healing history — historical success rate of fix attempts. If the LLM is degraded, the retry asks for concise output. If healing rarely works for this step, the Copilot escalates faster. This closed-loop makes the system adaptive rather than static.

A pre-built dashboard JSON ships with the project for immediate visualization of the full agent pipeline health.

---

## How Was Your Hackathon Experience

Great learning experience. Building the bidirectional SigNoz integration — where the system not only exports telemetry but reads it back to make smarter decisions — was the most interesting challenge. It shifted my thinking from "observability as a dashboard" to "observability as an input to system intelligence." The OpenTelemetry SDK and SigNoz Query API were straightforward to integrate. The standalone Docker image made local development fast. Overall, a solid hackathon that pushed me to think about how observability data can drive autonomous system behavior, not just human debugging.
