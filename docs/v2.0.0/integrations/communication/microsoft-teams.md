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

For the complete workflow, use the [Microsoft Teams ChatOps guide](./microsoft-teams/),
including Entra and Bot setup, destinations, Adaptive Card actions, optional
war-room consent, permissions, and troubleshooting.

Open **Services → your service → Notifications**, enable Microsoft Teams, and
link up to three team/channel destinations. All linked destinations receive the
service lifecycle messages. Test each channel independently and remove an old
destination before adding a fourth. Tenant mode controls which installations
may be selected; it does not replace the per-service destination mapping.

For validation, trigger a synthetic incident, confirm a single Adaptive Card in
each linked destination, use an action from one card, and verify that the other
cards and the OpsKnight incident converge on the same state.

Inbound activities must pass token, tenant, service-URL, and action-schema checks.
Graph permissions are separate from bot messaging permissions. Preserve the
activity identifier and trusted service URL when diagnosing delivery.
