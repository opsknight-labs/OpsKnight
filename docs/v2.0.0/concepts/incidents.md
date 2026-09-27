---
title: Incidents
description: The incident lifecycle and response record.
type: concept
product_area: incidents
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/incidents/lifecycle.ts, prisma/schema.prisma]
---

# Incidents

An incident is the durable coordination record for an operational disruption.
Its lifecycle, assignments, response events, notifications, and service context
must be treated as related but independently auditable state.

An incident belongs to a service and team, carries urgency and visibility, and
can have an assignee. Its lifecycle moves through triggered, acknowledged, and
resolved states; snooze, escalation, SLA timing, notifications, external links,
and public status projections are associated records rather than alternate
sources of lifecycle truth.

Lifecycle mutations are authorized server-side and append observable history.
Retries must preserve idempotency, and delayed work must confirm that the
incident generation is still current before acting. See the [response model](./incident-response)
and the [incident guides](../guides/incidents/create).
