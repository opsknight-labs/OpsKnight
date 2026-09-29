---
title: Configure Microsoft Teams destinations
description: Map OpsKnight services to Teams channels and test Adaptive Card delivery.
type: how-to
product_area: chatops
audience: [administrator]
reader:
  status: READER_COMPLETE
  task: Route a service's incident lifecycle to Microsoft Teams channels.
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/app/api/microsoft-teams/destinations/route.ts, src/app/api/microsoft-teams/test/route.ts]
---

# Configure Microsoft Teams destinations

## Before you begin

Complete the Teams installation and ensure it is enabled in the configured tenant.

## Open the feature

Open **Services → select the service → Notifications → Microsoft Teams**. Tenant installation and service routing are separate.

## Configure destinations

1. Enable Microsoft Teams delivery for the service.
2. Enable Microsoft Teams and choose an installed team and channel.
3. Add up to three destinations.
4. Save the service.
5. Test every destination. A successful test sends a real Adaptive Card through Bot Framework transport.

All active destinations receive service lifecycle cards. Only one destination
per service can own automatic war-room behavior; regular card delivery remains
independent.

## What OpsKnight does

All active destinations receive service lifecycle cards; they are not fallback priorities. Only one destination per service can own automatic war-room behavior. Routine card delivery remains separate from war-room provisioning and identity links.

## Verify it worked

Trigger a synthetic incident and confirm one card appears in every mapped
destination. Apply one action and verify all projections converge.

## Remove or change a destination

Open the same service page, remove the obsolete mapping, save, and retest remaining destinations. Removing routine delivery does not automatically close an incident war room.

## Troubleshooting

**Team/channel is absent:** confirm the app/bot installation is enabled in the configured tenant/team and discovery permissions are granted.

**Test fails for one channel:** inspect installation/destination service URL and provider result; another channel's success is not proof of access.

**Duplicate cards:** inspect multiple mappings and durable activity IDs before retrying.

## Next steps

- [Send a test](./send-test)
- [Understand incident cards](./incident-notifications)
- [Use incident actions](./incident-actions)
