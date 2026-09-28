---
title: Resolve an incident
description: Close active response with a resolution record.
type: how-to
product_area: incidents
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/components/incident/ResolveIncidentModal.tsx
    - src/lib/incidents/lifecycle.ts
---

# Resolve an incident

## Before you begin

Confirm mitigation is complete and prepare a useful resolution summary.

1. Select **Resolve** and enter the summary.
2. Verify terminal state, timeline history, and stopped escalation.

Open the incident, select **Resolve**, record a useful resolution summary, and
confirm. Verify that the status is **Resolved**, the resolution timestamp and
kind are stored, active escalation has ended, and the timeline contains the
terminal event.

Resolution ends active response but does not erase SLA history. Reopening is a
separate lifecycle action and must preserve the previous response record.
