---
title: Run OpsKnight Intelligence in production
description: Deploy, enable, monitor, roll out and roll back the recommendations-only Intelligence engine and the Squire assistant.
type: deployment
product_area: intelligence
audience: [operator, administrator]
reader:
  status: SOURCE_VERIFIED
  task: Take Intelligence from disabled to suggest mode safely, watch it, and turn it off again.
verification:
  level: test
  verified_at: 2026-10-29
  evidence: [src/lib/intelligence, monitoring/prometheus/opsknight-alerts.yaml, tests/integration/intelligence, tests/e2e/intelligence-ui.spec.ts]
---

# Run OpsKnight Intelligence in production

Intelligence suggests similar past incidents, related incidents, possible causes and runbooks, and runs
the Squire assistant. **It recommends; it never acts.** It cannot merge or suppress incidents, delay or
change paging, or run anything. It is off after upgrade and stays off until an administrator enables it.

Everything in this guide except process placement is configured in **Settings → Intelligence**. There are
no feature environment variables.

## What it needs

| Need | Detail |
|---|---|
| Database | The existing PostgreSQL. Migrations are additive. `pg_trgm` is optional; without it, matching uses full-text search, and Settings shows which tier is active. |
| Process | The lane runs inside `integrated`, `worker` and `general-worker` processes. For larger installs, run it alone with `OPSKNIGHT_PROCESS_ROLE=intelligence-worker`. That role has no scheduler, job worker or runbook duties. Size its pool with `DATABASE_POOL_SIZE_INTELLIGENCE_WORKER`. |
| Egress | None, unless you enable AI. Each AI provider is reached only at the address an administrator saved. Vertex AI also fetches short-lived tokens from Google's fixed OAuth endpoint. |
| Email | Only for the optional weekly digest, sent through the email provider configured under Notifications. |

Running several workers is safe. Work is claimed with `SKIP LOCKED` leases, so two replicas never process
the same item, and a crashed replica's work is picked up when its lease expires.

## Safety properties to rely on

- **Paging is never affected.** The lane only reads incidents after they exist; nothing is written when an
  incident is created. When escalation or notification work falls behind, the lane pauses itself and
  resumes when that work clears.
- **Bounded cost.** Every analysis runs with a statement and lock timeout from Settings, a per-item time
  budget and capped candidate counts.
- **No data leaks.** Every suggestion is filtered by the viewer's own access when shown, in the UI, the REST
  API and the assistant.
- **Readiness never fails because of it.** `/api/health?mode=readiness` reports `intelligence` as `healthy`,
  `degraded` or `disabled`, never `unhealthy`.

## Monitor it

The metrics scrape adds five gauges:

| Metric | Meaning |
|---|---|
| `opsknight_intelligence_queue_ready` | Work waiting to run |
| `opsknight_intelligence_queue_oldest_ready_age_seconds` | Age of the oldest waiting item |
| `opsknight_intelligence_dead_letters` | Items that exhausted their retries |
| `opsknight_intelligence_lane_paused` | `1` while the lane is yielding to paging, per instance |
| `opsknight_intelligence_lane_last_cycle_age_seconds` | Seconds since the lane last finished a cycle, per instance |

Lane gauges exist only on instances running the lane, so a disabled install exports nothing that alerts.

`monitoring/prometheus/opsknight-alerts.yaml` includes the `opsknight.intelligence` group. Every rule is a
**warning**. Intelligence is advisory, so nothing here should wake anyone at night.

| Alert | Fires when | First response |
|---|---|---|
| `OpsKnightIntelligenceLaneStalled` | No completed cycle for 5 minutes, sustained 5 minutes | Check worker logs and database health; restart the worker if wedged. |
| `OpsKnightIntelligencePausedForPaging` | Paused for 15 minutes | Investigate the paging backlog first. Intelligence resumes on its own. |
| `OpsKnightIntelligenceBacklogStale` | Oldest work waiting over 15 minutes, sustained 10 minutes | Raise batch size or concurrency in Settings, or add an `intelligence-worker`. |
| `OpsKnightIntelligenceDeadLetters` | Any dead letter for 15 minutes | Review and replay them in Settings → Intelligence. |

Work items and AI calls also emit OpenTelemetry spans (`intelligence.work`, `intelligence.ai.generate`,
`intelligence.ai.stream`) when a tracer provider is registered. Spans carry categories and token counts,
never incident data, prompts or answers.

## Roll it out

Do each step on one environment before the next, and keep a step running long enough to see a normal week of
incidents.

1. **Shadow.** In Settings → Intelligence, turn on the master switch and publish the global policy in
   **Shadow** mode. Everything is computed and stored; nobody sees it. Watch the dashboards above and your
   ingestion and paging latency. Nothing should change.
2. **Suggest for one service.** In **Per-service policies**, give one well-understood service its own
   **Suggest** policy. Ask its responders to use the thumbs on suggestions.
3. **Review quality.** **Insights** shows how ratings fall by match score. If low scores are mostly
   unhelpful it proposes a higher threshold, which you apply with one click as a new policy version.
4. **Suggest globally.** Publish the global policy in **Suggest** mode. Keep noisy services on Shadow with
   their own policies.
5. **Assistant without AI.** In **Assistant & AI**, turn on the assistant and leave AI off. It answers from
   your incident data only.
6. **Assistant with AI.** Add a provider and use **Test connection**. Start with a self-hosted model or a
   provider your data-processing agreement covers, set its data ceiling to **Internal**, and set a daily token
   budget. Leave **Allow fallback from self-hosted to external providers** off unless you have decided
   otherwise. If data must stay in a region, tag each provider with its region and set **Allowed data
   regions**; untagged providers are then never used.
7. **Summaries and drafts.** Incident summaries and postmortem drafts send timelines and responder notes,
   so they only run on a provider whose ceiling is **Personal**. Leave every provider at **Internal** to keep
   them unavailable.
8. **Optional extras.** Each is off until you turn it on:
   - **Semantic search**: give a provider an embedding model and turn on semantic search. The AI page shows
     indexing progress. Watch the token budget for the first day while recent incidents are indexed.
   - **Saved conversations**: choose a retention period first. Turning it off later deletes all saved
     conversations.
   - **Weekly digest**: in **Insights**, pick a day and hour, then use **Send me a test**.
   - **Suggested grouping rules**: in **Insights**, once responders have confirmed links, use **Find rule
     suggestions** and add any that look right. Each one becomes a new policy version that you can roll
     back.

## Turn it off

Each control takes effect within seconds, needs no restart, and leaves paging exactly as it was.

| To stop | Do |
|---|---|
| Everything | Turn off the master switch in Settings → Intelligence. Stored data is kept until retention removes it. |
| One service | Give it its own policy in **Off** mode, or return it to the global policy. |
| A bad policy change | Restore an earlier version from the policy history. This publishes a new version; history is never rewritten. |
| AI only | Turn off **Enable AI**. The assistant keeps answering in basic mode. |
| The assistant | Turn off **Show the assistant**. Its code is then not sent to browsers at all. |
| Semantic search | Turn off **Semantic search**. Matching immediately reverts to wording only; stored vectors age out with fingerprint retention. |
| Saved conversations | Turn off **Let people save assistant conversations**. All saved conversations are deleted by the next sweep (within about 15 minutes). |
| The weekly digest | Turn it off in **Insights**. A digest already queued for this week is dropped. |
| A learned rule | Restore the policy version from before it was added. |

To remove the dedicated worker, stop the `intelligence-worker` process; the general worker roles take
the lane back.

## Data and retention

Retention for fingerprints, correlation, findings, change events and feedback is set in Settings and
enforced by a bounded background sweep, which keeps running even while Intelligence is off. Embedding vectors
follow fingerprint retention, and digest delivery records follow finding retention. Assistant conversations
are not stored unless saved conversations are turned on; then they are encrypted, visible only to their
owner, and removed after the retention period, when the setting is turned off, or when the person is
deleted. Audit entries for AI use record who, which capability, which provider and model, the prompt
version and token counts, never prompts or answers. See the privacy registry entries `intelligence` and
`ai-assistant`.

## Not in this release

Automatic grouping, any delay or suppression of paging, and assistant write actions are not implemented.
They need separate certification before they can exist. The open certification gates are listed in
`plans/intelligence-engine/certification/README.md`. Learned rules are only ever suggested; a person adds them.
