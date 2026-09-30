---
title: Microsoft Teams ChatOps
description: Configure the Teams application, destinations, incident cards, and war rooms.
type: concept
product_area: chatops
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/lib/microsoft-teams/app-manifest.ts, src/lib/microsoft-teams/auth.ts, src/lib/war-room/providers/microsoft-teams/adapter.ts]
---

# Microsoft Teams ChatOps

Teams uses a registered Entra application, Azure Bot messaging endpoint, a
Teams app package, tenant-scoped installation records, service destinations,
and Adaptive Cards. It is not a Slack configuration with renamed fields.

- [Connect Microsoft Teams](./connect)
- [Configure service destinations](./configure-destinations)
- [Send and verify a test](./send-test)
- [Understand normal incident cards](./incident-notifications)
- [Use Adaptive Card actions](./incident-actions)
- [Link responder identities](./identity-linking)
- [Configure Teams war rooms](./war-rooms)
- [Review permissions](./permissions)
- [Disconnect or reconnect](./disconnect-reconnect)
- [Troubleshoot Teams](./troubleshooting)
