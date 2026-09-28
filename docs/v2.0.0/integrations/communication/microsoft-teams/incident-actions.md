---
title: Use Microsoft Teams incident actions
description: Act on OpsKnight incidents from verified Adaptive Cards.
type: how-to
product_area: chatops
audience: [responder]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/app/api/microsoft-teams/messages/route.ts, src/lib/microsoft-teams/auth.ts]
---

# Use Microsoft Teams incident actions

## Before you begin

Install Teams, map a service destination, and trigger a synthetic incident.

Adaptive Card actions enter through the Bot messaging endpoint. OpsKnight
validates the Bot token, tenant, trusted service URL, installation, destination,
action schema, identity, and product authorization before applying a command.

1. Open the incident Adaptive Card.
2. Choose an action available to your responder role.
3. Complete identity linking if prompted.
4. Confirm the OpsKnight timeline and all destination cards converge.

After acknowledging or resolving, verify that all cards for the incident and
the OpsKnight timeline converge. Preserve the activity ID and service URL when
reporting a failure.
