## I built an AI agent that argues with itself before it ships anything — here's what that actually looks like

A few weeks ago I asked one of my own AI agents to do something completely ordinary:

> *"Connect to my local PostgreSQL database at 192.168.1.50 and fix the broken migration in table users_v3."*

It came back fast. Confident tone, clean headers, SQL code blocks, a tidy conclusion. My own reviewer step scored it 0.79 out of 1.0 — close enough to "done."

Then I actually read it.

*"Replace `username` and `database_name` with the actual credentials."*
*"Replace `new_column` and `data_type` with the actual column name."*

It hadn't fixed anything. It had described the shape of a fix, in the confident voice of something that had already done the work. That gap — between sounding done and being done — is the entire reason I spent the last stretch of the hackathon building **SignozForge Observer**.

---

### The blind spot I kept running into

Every AI agent I'd built or used shared the same failure mode. Not crashing — crashing is easy to catch. The dangerous failures were the ones that looked fine:

- Hedging language dressed up as a solution ("you would need to," "assuming that," "contact the administrator")
- Output that's mostly explanation and barely any actual code or query
- Retries that quietly produce the same generic answer again
- A reviewer score that looks fine on paper while its own reasoning says "lacks specific details"
- No visibility into *why* something failed or *what the system already tried*

Most agent setups ship the first answer that clears a threshold. I wanted mine to push back on itself first.

---

### Four agents, one supervisor watching all of them

The pipeline itself is simple on purpose:

- **Coordinator** breaks the request into a research → build → review plan
- **Researcher** gathers the facts the build step actually needs
- **Coder** produces the real deliverable — not a description of one
- **Reviewer** scores it across five dimensions using an LLM-as-Judge pattern

The part that isn't standard is what sits above all four: the **SRE Copilot**. Instead of trusting a single quality score, it runs **seven independent anomaly detectors** against the actual content of every step — hedging language, placeholder text, code-to-prose ratio, topic drift, repeated output across retries. A 0.79, even a 0.82, doesn't get a free pass just because it's a number above a line.

When the Copilot catches something, it doesn't just reject it — it tries to fix it:

1. **Reword** — the specific failure gets written back into the brief and the step reruns with that context attached
2. **Rethink** — if that's not enough, the retry is forced to take a completely different approach, not a rephrased version of the same idea
3. **Manual Mode** — two strikes and it stops, handing over the partial output *and* the exact reason it stopped

---

### What a clean run actually looks like

Not every task needs saving. Here's one that just worked: *"Write unit tests for a user authentication module in TypeScript."*

And the backend log is just as boring, which is exactly the point:

```
[COPILOT 19:06:33] No anomaly in 'research' -- continuing
[COPILOT 19:06:34] No anomaly in 'code' -- continuing
[COPILOT 19:06:35] No anomaly in 'review' (score 0.90) -- continuing
```

No drama. The Copilot isn't there to slow down good work — it's there for the tasks that only *look* good.

---

### And here's the one that needed saving

Same pipeline, the Postgres migration task from the top of this post. Quality 79%. Manual Mode. Three anomalies, not one.

The Copilot didn't just say "this feels off" — it named exactly what was wrong:

- `vague_answer` — Research described a process instead of solving the task (two hedging markers detected)
- `prose_not_code` — Code output was only 14% actual code — 232 of 1,709 characters
- `weak_score` — 0.79 sits below the Copilot's own strict bar of 0.88

Attempt 1 (reword) succeeded on the research step. Attempt 2 (rethink) still wasn't enough on the code step.

And here's the actual backend log for that run — nothing dressed up, this is what printed to the terminal in real time:

```
[ANOMALY DETECTED]  [19:31:47]
  Step: research
  Issue: Output in 'research' describes a process instead of solving the task
  (2 hedging markers: ['requires further investigation', 'unknown (requires'])

[COPILOT HEALING] Attempt 1
  Strategy: REWORD
  Target step: research

[COPILOT 19:31:48] No anomaly in 'research' -- continuing

[ANOMALY DETECTED]  [19:31:49]
  Step: code
  Issue: Output is mostly prose, not code (14% code — 232 of 1709 chars)

[COPILOT HEALING] Attempt 2
  Strategy: RETHINK
  Target step: code

[COPILOT 19:31:50] No anomaly in 'code' -- continuing

[ANOMALY DETECTED]  [19:31:51]
  Step: review
  Issue: Quality score 0.79 is below the Copilot strict bar 0.88

[MANUAL MODE ACTIVATED]  [19:31:51]
  Reason: Auto-fix cap reached (2 attempts). Quality score 0.79 is below
  the Copilot strict bar 0.88 — answer is not strong enough
  Action: Developer intervention required
```

Two strikes, then it stopped and told me why — instead of either looping forever or quietly handing me a 79%-quality answer dressed up as complete.

---

### The RAM context store — nothing hidden, even mid-run

Because task state lives entirely in memory, keyed by `task_id`, I can inspect exactly what each agent saw and produced at any point, mid-run. The exact research step output, the exact code step output, still sitting in memory — nothing hidden even while a task is in Manual Mode.

---

### Why SigNoz isn't a dashboard here — it's the decision engine

This is the part I'm most proud of, because it would've been easy to bolt observability on as an afterthought — a dashboard that just watches. I wanted the Copilot to actually *use* what's being observed.

Every agent span (`agent.coordinator`, `agent.researcher`, `agent.coder`, `agent.reviewer`), every `llm.call`, and every Copilot decision (`copilot.evaluate`, `copilot.heal`) shows up in SigNoz with attributes like token count, latency, anomaly type, and retry strategy attached.

But the loop that actually matters is the one on the right side of that page — **what the Copilot reads back out of SigNoz** before it decides anything:

- **Step Health History** — has this step been failing a lot in the last 30 minutes? If so, the fix hint gets extra caution baked in.
- **LLM Provider Health** — is p95 latency spiking? If the LLM itself is degraded, the retry asks for shorter output instead of blaming the prompt.
- **Healing Success Rate** — if fixes at this step have historically worked less than 30% of the time, the Copilot escalates faster instead of burning a second attempt on a strategy that rarely pays off.
- **Recent Error Traces** — the specific failure context from last time gets folded directly into the next fix hint.

SigNoz also carries the business-level view — `signozforge.tasks.submitted/completed/failed`, `signozforge.copilot.healing_attempts/successes`, `signozforge.copilot.manual_mode_triggers` — so AI quality and operational reliability sit in one place, not two.

---

### A few decisions I'd make again

- **A 0.88 strict floor, not the configured 0.6 pass threshold.** "Technically passing" and "good enough to ship" are not the same sentence.
- **A hard two-strike cap.** Reword and rethink cover the repair space that matters. An unbounded retry loop is exactly the failure mode this whole project exists to prevent.
- **RAM-only context, no database.** Fast, ephemeral, every task a clean slate — and it made the Context Inspector trivial to build.
- **Manual Mode as an honest signal, not a failure.** When the system can't fix something, it says so, with the partial work and the reasoning attached.

---

### Where I'm taking this next

Persistent healing memory, so a fix strategy that worked once gets reused on similar tasks. Adaptive quality thresholds tuned automatically off SigNoz's observed score distribution. Automatic fallback to a backup model when SigNoz shows the primary LLM degrading. SigNoz-native alerting so a dropping healing success rate reaches me directly instead of me having to notice it.

The thing I keep coming back to: **trustworthy AI agents aren't the ones that never fail. They're the ones that know when they've failed, try to fix it, and tell you the truth when they can't.**

That's not a better prompt. That's an observable system — and for me, that meant building it on SigNoz from the first line of code, not bolting it on at the end.

---
