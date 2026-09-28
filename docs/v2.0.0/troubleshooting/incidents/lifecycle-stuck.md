---
title: Incident lifecycle action is stuck
description: Diagnose an acknowledgement, assignment, escalation, or resolution that does not converge.
type: troubleshooting
product_area: incidents
audience: [operator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/incidents/lifecycle.ts, src/lib/incidents/idempotent-commands.ts]
---

# Incident lifecycle action is stuck

Refresh the canonical incident, inspect the latest timeline and audit entries,
and identify whether the request failed before or after the database mutation.
Check authorization, current status, idempotency key, outbox state, and worker
health. Do not directly edit lifecycle columns. Preserve the incident identifier,
request identifier, actor, attempted transition, and timestamps.

## Determine where progress stopped

1. Reload the incident and compare its canonical status with the action response.
2. Inspect timeline and audit entries for the same actor and request identifier.
3. Check the HTTP response: `403` indicates authorization, `409` indicates a
   stale/conflicting transition, and `5xx` requires server and worker inspection.
4. Inspect queued side effects only after confirming the database transition.

If status changed but notifications did not, follow the notification runbook;
repeating the lifecycle action can create unnecessary downstream work. If status
did not change, verify the requested transition is legal from the current state
and repeat once with a new operator action after correcting the cause.

## Verify recovery

Confirm one canonical transition, one matching audit entry, and eventual message,
status-page, and ChatOps convergence. Escalation evidence should include incident
ID, old/new status, request ID, actor, response code, and relevant worker errors.
