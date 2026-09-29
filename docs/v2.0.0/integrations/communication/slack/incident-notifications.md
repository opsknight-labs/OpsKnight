---
title: Understand Slack incident notifications
description: Learn how OpsKnight projects incident lifecycle state to Slack destinations and how updates, identity, and delivery failures behave.
type: concept
product_area: chatops
audience: [administrator, responder, operator]
keywords: [Slack incident notification, message update, lifecycle]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/lib/chatops/, src/lib/slack.ts]
---

# Understand Slack incident notifications

OpsKnight is the source of truth for incident state. Each active service destination receives a projection. Subsequent lifecycle changes update or reconcile that projection using durable provider/message identities and idempotent delivery keys.

The message can expose only actions allowed by the shared ChatOps policy. A provider message is not an independent incident record; manually editing or deleting it does not change the OpsKnight incident.

## Routine destinations and war rooms

Routine service destinations receive incident lifecycle messages. A war room is a separate incident-scoped channel with provisioning, membership, context, and cleanup. Configuring one does not configure the other.

## Delivery and convergence

Provider throttling, removed bot access, deleted messages/channels, revoked tokens, or worker/database failures can delay a projection without changing the incident. Use OpsKnight delivery/operation state to diagnose and retry safely; avoid manual duplicate posts.

## Identity and actions

Viewing a message does not require an OpsKnight identity link. User-attributed actions do. OpsKnight validates Slack signatures/timestamps, maps the Slack user, then applies normal product authorization and incident-state rules.

## Related guides

- [Configure service channels](./configure-service-channels)
- [Acknowledge and resolve](./acknowledge-resolve)
- [Operate war rooms](./war-rooms)

