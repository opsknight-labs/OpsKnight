---
title: Understand Microsoft Teams incident cards
description: Learn the content, lifecycle, delivery, update, and source-of-truth behavior of normal OpsKnight Adaptive Cards.
type: concept
product_area: chatops
audience: [administrator, responder, operator]
keywords: [Teams incident card, Adaptive Card, lifecycle]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/lib/microsoft-teams/, src/lib/chatops/]
---

# Understand Microsoft Teams incident cards

A normal service-destination Adaptive Card presents current incident context such as status, service, urgency, assignee, priority, description, and creation time. It is not itself a war room.

![Normal OpsKnight incident Adaptive Card in Microsoft Teams showing status, service, urgency, assignee, and priority](/docs/v2.0.0/assets/teams-incident-card.png)

OpsKnight remains authoritative. Cards are provider projections associated with tenant installation, destination, service URL, and activity identity. Lifecycle actions reconcile all projections; manually changing/deleting Teams content does not mutate the incident.

## Normal card versus war-room card

Routine destinations receive lifecycle cards. War-room provisioning creates an incident-scoped channel and may show a video bridge plus responder actions. War rooms require additional resource-specific consent and a designated owner destination.

![OpsKnight Microsoft Teams war room card with video bridge and incident actions](/docs/v2.0.0/assets/teams-chatops-war-room.png)

## Delivery and identity

Viewing does not require an OpsKnight identity link. User-attributed actions do. OpsKnight validates Bot token, tenant, service URL, installation, destination, activity/action schema, mapped user, authorization, and incident transition.

Provider throttling, expired credentials, disabled installations, changed service URLs, deleted activities/channels, or worker failures can delay projection without changing incident state. Inspect OpsKnight operation/delivery state before retrying.

## Related guides

- [Configure destinations](./configure-destinations)
- [Use incident actions](./incident-actions)
- [Configure war rooms](./war-rooms)

