---
title: Create an incident
description: Create an incident for a service and verify its initial response state.
type: how-to
product_area: incidents
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/app/(app)/incidents/actions.ts
    - src/lib/incidents/creation.ts
---

# Create an incident

## Prerequisites

You need `incident.create.all` or `incident.create.scoped` for an eligible
service. Confirm that the service ownership, escalation policy, and response
targets are correct before creating a test incident.

## Steps

1. Open **Incidents** and select **Create incident**.
2. Select the affected service.
3. Enter a concise title and an operational description.
4. Choose urgency, visibility, and any supported classification fields.
5. Submit the incident once.

## Expected result and verification

The incident opens with a frozen response-target contract, an initial timeline
event, and the selected service context. Refresh the detail page and confirm the
same incident remains visible. If alert ingestion is also being tested, use a
unique correlation key so the manual and inbound tests cannot collide.

## Common mistakes

- Selecting a service outside the actor's scope.
- Retrying a slow submission and creating an unrelated second incident.
- Treating a later service-policy edit as a change to an existing incident's SLA.

See [Incidents](../../concepts/incidents.md) and [Incident SLA](../../concepts/incident-sla.md).

