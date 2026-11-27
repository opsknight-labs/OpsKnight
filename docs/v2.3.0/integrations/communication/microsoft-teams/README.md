---
title: Microsoft Teams ChatOps
order: 1
description: Configure the Teams application, destinations, incident cards, and war rooms.
type: concept
product_area: chatops
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-11-27
  evidence: [src/lib/microsoft-teams/app-manifest.ts, src/lib/microsoft-teams/auth.ts, src/lib/microsoft-teams/health-checklist.ts, src/lib/microsoft-teams/secret-expiry.ts, src/lib/war-room/providers/microsoft-teams/adapter.ts]
---

# Microsoft Teams ChatOps

Teams uses a registered Entra application, Azure Bot messaging endpoint, a
Teams app package, tenant-scoped installation records, service destinations,
and Adaptive Cards. It is not a Slack configuration with renamed fields.

Start with [Connect and configure Microsoft Teams ChatOps](./connect), which
covers the complete Microsoft 365 path from Entra registration and Azure Bot
through package consent, destinations, actions, war rooms, and acceptance.

## Check Teams health

**Settings → Integrations → Microsoft Teams** shows a live health checklist: the bot credentials, the client secret's expiry, the tenant, whether the app is installed in Teams, the installed app package version, and the Teams permissions (RSC). A client secret that is close to expiring, or already expired, is flagged before it breaks delivery. A team near Microsoft's channel limit is flagged too, so war-room creation does not fail without warning. Administrators can read the same checks as JSON at `/api/microsoft-teams/health`. Each destination has a **Send test card** action that reports a plain-English reason when it fails.

The app package is versioned. Package **1.4.0** adds the conversational bot, so `@OpsKnight` and direct messages reach Squire and Teams shows the bot's command list. Package 1.3.0 keeps working; download the updated package from the same page to get the conversation features.

## Recommended setup sequence

1. [Register Entra, configure Azure Bot, and install the package](./connect).
2. [Review RSC and Graph permissions](./permissions) before granting consent.
3. [Configure service destinations](./configure-destinations) and test each one.
4. [Link responder identities](./identity-linking).
5. Validate [incident cards](./incident-notifications) and
   [actions](./incident-actions) with a synthetic incident.
6. Configure and rehearse [war rooms and video bridges](./war-rooms) when required.
7. Document [troubleshooting](./troubleshooting) and
   [disconnect/reconnect](./disconnect-reconnect) ownership.

- [Connect and configure Microsoft Teams ChatOps](./connect)
- [Configure service destinations](./configure-destinations)
- [Send and verify a test](./send-test)
- [Understand normal incident cards](./incident-notifications)
- [Use Adaptive Card actions](./incident-actions)
- [Link responder identities](./identity-linking)
- [Configure Teams war rooms](./war-rooms)
- [Review permissions](./permissions)
- [Disconnect or reconnect](./disconnect-reconnect)
- [Troubleshoot Teams](./troubleshooting)
