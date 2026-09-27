---
title: Create an incident war room
description: Provision and manage a provider-backed collaboration room.
type: how-to
product_area: chatops
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/war-room/engine.ts
    - src/lib/war-room/reconcile.ts
---

# Create an incident war room

Configure a supported Slack or Microsoft Teams destination before response work
begins. From an active incident, create the war room and wait for provisioning to
reach a terminal state. Open the returned provider URL and verify the projected
incident content and intended participants.

The incident is authoritative. If provider state drifts, use health diagnostics
and reconciliation instead of manually changing both systems. Close or archive
the room through the incident workflow so cleanup state remains auditable.

