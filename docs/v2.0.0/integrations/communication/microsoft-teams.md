---
title: Microsoft Teams
description: Configure Teams messaging, interactive cards, and incident war rooms.
type: integration
product_area: chatops
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/microsoft-teams/provider.ts
    - src/lib/war-room/providers/microsoft-teams/adapter.ts
---

# Microsoft Teams

Register the Teams application, configure tenant mode and encrypted credentials,
install it in the intended tenant, and map destinations to OpsKnight services.
Use a synthetic incident to verify Adaptive Card delivery, action validation,
identity linking, participant synchronization, and war-room cleanup.

Inbound activities must pass token, tenant, service-URL, and action-schema checks.
Graph permissions are separate from bot messaging permissions. Preserve the
activity identifier and trusted service URL when diagnosing delivery.

