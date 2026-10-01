---
title: Troubleshoot escalation policies
description: Diagnose missing targets, wrong recipients, timing, duplicate pages, non-advancement, and acknowledgement suppression failures.
type: troubleshooting
product_area: escalation
audience: [administrator, responder, operator]
reader:
  status: READER_COMPLETE
  task: Diagnose and recover a failed escalation route.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/lib/escalation/, src/lib/notification-delivery.ts]
---

# Troubleshoot escalation policies

## No recipient is resolved

Check service policy attachment, active incident/current generation, target existence, team membership/lead mode, schedule coverage/override, user status, and personal endpoint eligibility. Correct the target and run a controlled test.

Trace one incident from the service outward: service → attached policy → current
policy generation → eligible step → resolved user/team/schedule → enabled user
endpoint. Record the first empty result. Do not compensate for an empty schedule
by adding a broad fallback user until the coverage defect is understood.

## Wrong responder is paged

Check incident service/policy, execution timestamp, schedule zone/overrides, team membership, and recorded target resolution. Communicate accidental paging and correct the narrow source.

## Next step is late or never advances

Check incident remains open/unacknowledged, configured cumulative timing, scheduler heartbeat/lag, queue oldest age, database, provider retries, and worker health.

Compute the expected due time from the incident's escalation start and cumulative
step delays, in UTC. If the due time is still in the future, the policy is working
as configured. If it passed and no claim exists, inspect scheduler ownership. If
a claim exists but no delivery completed, inspect the notification worker and
provider attempt instead of editing the policy.

## Acknowledgement does not stop later work

Check acknowledgement time/state, concurrent step claim, incident/policy generation, and delivery already emitted before acknowledgement. An already sent provider notification cannot be recalled.

## Duplicate notifications occur

Check provider retry/idempotency, repeated manual escalation, duplicated targets across steps, concurrent workers, and projection/delivery operation IDs before retrying.

Compare intent ID, delivery operation ID, recipient endpoint, provider message
ID, and incident generation. The same provider message shown twice is a provider
or client-display issue; two operation IDs indicate duplicate scheduling or a
manual action. A single person can legitimately receive two intents when they
appear through both a direct and team/schedule target.

## Evidence to collect

Preserve incident ID and generation, service and policy IDs, expected/due times,
resolved target, scheduler heartbeat, queue age, intent/attempt IDs, provider
status, and acknowledgement time. Redact endpoint addresses and credentials.

## Recovery verification

Use [Test an escalation policy](./test-policy) and confirm target, delivery, timing, acknowledgement behavior, fallback, and resolution evidence.
