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

