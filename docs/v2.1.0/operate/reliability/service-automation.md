---
title: Operate service automation in production
description: Monitor routing and observation health, interpret candidate evidence, manage privacy cleanup, and recover automation safely.
type: how-to
product_area: services
audience: [administrator, operator, responder]
verification:
  level: source
  verified_at: 2026-10-30
  evidence:
    - src/lib/automation/comparison.ts
    - src/lib/automation/readiness.ts
    - src/lib/automation/readiness-policy.ts
    - src/lib/automation/observation-batch.ts
    - src/lib/automation/observation-privacy.ts
    - src/lib/automation/discovery.ts
    - src/lib/automation/privacy-cleanup.ts
    - src/lib/automation/jobs.ts
    - src/lib/automation/settings-command.ts
    - src/lib/automation/settings.ts
    - tests/integration/automation-settings.test.ts
    - src/lib/metrics/operational/registry.ts
---

# Operate service automation in production

## Prerequisites

Have administrator access for global settings and activation, a known-good service
routing baseline, access to worker/provider health, and the service/version IDs
for the change. Use the [rollout guide](../../guides/services/service-automation)
for authoring. This page covers steady-state operation and recovery.

## Configuration source and deployment changes

Automation enablement, retention, preview storage, and readiness policy are read
from shared database settings. Changing an environment variable named
`OPSKNIGHT_AUTOMATION_ENABLED` or `OPSKNIGHT_AUTOMATION_TRACE_RETENTION_DAYS` does
not replace those settings. Use the administrator UI or settings API, and review
the settings revision to avoid overwriting another administrator's change.

Before upgrading a multi-role deployment, apply the supported database migrations
and verify the scheduler, ingestion roles, and workers run compatible application
versions. Preserve the normal [backup](../data/backup-and-restore) and
[upgrade](../upgrades/upgrade) procedures. Do not infer Live routing readiness from
a successful web-process start or the presence of an observation queue alone.

## Daily operating procedure

1. Open service Automation Overview and verify global enablement, service mode,
   active version, and any candidate. Distinguish the draft from executable versions.
2. Review recent evaluations and errors/fallbacks. Inspect a representative incident's
   pinned decision when a route or priority is unexpected.
3. Check observation queue depth, oldest age, and Shadow rollup lag alongside worker
   health. A successfully accepted alert need not have its diagnostic rollup yet.
4. Review delivery records for supplemental channels independently of routing outcomes.
5. Before approving a candidate, review the correct candidate ID, evidence window,
   pending/processing work, policy revision, and material behavior differences.

Monitor `opsknight_automation_fallback_total`,
`opsknight_automation_observation_queue_depth`,
`opsknight_automation_observation_oldest_age_seconds`, and
`opsknight_automation_shadow_rollup_lag_seconds`. See [Prometheus](./prometheus)
and [metrics](../../reference/metrics) for the surrounding monitoring setup.
Avoid interpreting a 15 ms evaluator guard as an ingestion or provider-delivery SLA.

## Interpret comparison counters correctly

Shadow compares the proposed version to ordinary routing and priority. A Live
candidate compares to the actual active Live decision. The comparison resolves
service-default versus explicit policies to effective policy identities; naming
the same policy explicitly need not be a route difference.

Intentional **No escalation** remains a distinct decision even if the service has
no default policy. `noEscalationDifferent` reports a change in suppression state;
`routeDifferent` includes that change. `priorityDifferent` reports priority changes.
The counters can overlap: do not sum them as a count of unique divergent events.
`same` means no route or priority difference in this comparison; it is not a claim
that tags, all context values, and every downstream side effect were identical.

Errors and fallbacks can describe the same failed evaluation. Candidate readiness
uses `max(errors, fallbacks) / evaluated`, not their sum. The seven-day aggregation
window and daily bucket freshness are not exact event-time reporting.

## Configure candidate readiness policy

An administrator can change these global policy fields:

- `minimumEvaluations`: 1–1,000,000; default 100.
- `maximumEvidenceAgeHours`: 24–168; default 48.
- `maximumPendingObservations`: 0–1,000; default 0.
- `maximumErrorRate`: 0–1; default 0, expressed as a fraction rather than percent.

The quantity floor and latest-bucket age jointly determine sufficient recent
evidence. Pending/processing jobs are checked against the configured allowance;
a truncated result is a lower bound, not an exact full backlog count. The separate
freshness summary samples pending jobs only; the promotion readiness check also
includes processing jobs. Use readiness as the activation authority.

Acknowledge insufficient/stale evidence, excessive errors, and material differences
only after reviewing their cause. A backlog above allowance and an invalid policy
remain blocking. A policy threshold is a review floor, not proof that traffic
covers every important incident case. Include low-volume routes in manual samples.

## Understand bounded discovery

Sample discovery visits at most 256 nodes, returns at most 64 scalar suggestions,
traverses at most six levels, and inspects the first four elements of each array.
A missing suggestion does not prove a configured extraction path cannot work:
explicit extraction has a separate depth bound of 12. Scalar suggestions longer
than 256 characters and sensitive paths/values are excluded.

Persisted observation admission is bounded to 5,000 rows per service and 256 rows
per field within an integration. At a bound, existing identities can still accrue
counts while new identities are skipped. Frequencies are diagnostic observations,
not an unrestricted payload inventory or a complete census of every distinct value.
Do not delete production rows merely to make discovery display a new suggestion;
author the known safe field explicitly and review retention.

Discovery identities use a service-scoped keyed hash derived from `API_KEY_SECRET`
or, when absent, `NEXTAUTH_SECRET`. Without either secret, discovery identities
cannot be produced; this does not itself disable Live routing. Rotating the signing
secret begins a new identity space; old observations expire through retention.
Never expose those secrets to diagnose missing observations.

## Manage privacy and retention

Preview storage is off by default. To retain bounded readable examples, an
administrator must opt in and users still need sensitive incident access. Do not
confuse preview storage with full trace/source access or normalized-alert replay.
The sensitive-value filters are not a guarantee that arbitrary free text has no
personal information.

To stop retaining previews:

1. Disable preview storage in system settings and save the current settings revision.
2. Confirm previews are hidden from readers immediately.
3. Monitor privacy cleanup status while workers scrub retained rows and queued payloads.
4. If status is FAILED, keep preview storage disabled and use the administrator retry
   control. Retry resets the latest failed cleanup job and records an audit event.
5. Confirm COMPLETE. SUPERSEDED means preview storage was re-enabled during cleanup;
   reassess the intended privacy policy rather than treating it as completed removal.

Cleanup also has PENDING state. Batches are bounded and physical removal is
asynchronous. Retention deletes old traces by evaluation time and old discovery
rows by last-seen time, up to 1,000 of each per maintenance batch, scheduling more
work when required. Retention continues after global OFF once history exists.
It is not an incident-decision rewrite or version rollback mechanism.

## Recovery procedure

1. Preserve incident IDs, active/candidate IDs, effective mode, fallback reasons,
   and the relevant audit entries. Do not copy sensitive payloads into tickets.
2. For an incorrect candidate, discard it; leave the known-good active version routing.
3. For active service misrouting, disable that service. Accepted work can retain its
   original pointers; for an emergency affecting enabled backlog, use global OFF.
4. Inspect incidents already created. Disabling does not recall committed provider
   deliveries, reassign responders, resolve incidents, or rewrite SLA contracts.
5. Restore a reviewed version to the draft, test it, and publish through the normal
   workflow. If still Live, promotion is required. Check dependencies again because
   historical destinations/policies may no longer be usable.
6. Re-enable global automation if needed, then enable services individually. Global
   OFF reset their operational modes. Every request selecting Live reruns its mode
   activation checks; recovery is not exempt from evidence/dependency review.
7. Send a controlled alert with a fresh deduplication key. Verify the new incident's
   decision and actual responder/channel behavior before wider rollout.

For healthy routing but delayed observations, recover the scheduler/worker path
and allow durable jobs to drain. Do not republish solely to refresh the counters;
a new version has its own evidence identity. For channel failures, diagnose the
[notification pipeline](../../troubleshooting/notifications/not-delivered).
