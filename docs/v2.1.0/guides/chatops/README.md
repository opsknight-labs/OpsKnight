---
title: ChatOps and incident collaboration
order: 1
description: Configure provider policy, incident actions, and Slack or Microsoft Teams war rooms.
type: concept
product_area: chatops
audience: [administrator, responder]
verification: { level: source, verified_at: 2026-10-01, evidence: [src/lib/chatops, src/lib/war-room] }
---

# ChatOps and incident collaboration

ChatOps projects incident state into Slack or Microsoft Teams and lets authorized
responders act without losing the OpsKnight incident as the source of truth.

Start in this order:

1. Connect [Slack](../../integrations/communication/slack/) or
   [Microsoft Teams](../../integrations/communication/microsoft-teams/).
2. Configure the [global and service policy](./configure-global-policy).
3. Test a provider destination and responder identity.
4. [Create and operate a war room](./create-war-room).
5. Verify actions, membership synchronization, reconciliation, and closure.

Use the provider troubleshooting guide for installation, scopes, delivery, or
identity problems. Use the war-room guide for lifecycle or duplicate-prevention
problems.
