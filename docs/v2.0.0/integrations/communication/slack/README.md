---
title: Slack ChatOps
description: Connect Slack, route incident messages, act on incidents, and operate war rooms.
type: integration
product_area: chatops
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/lib/slack/app-manifest.ts, src/lib/chatops/, src/lib/war-room/providers/slack/adapter.ts]
---

# Slack ChatOps

Connect one Slack workspace to deliver incident lifecycle messages, accept
interactive responder actions, run `/incident` commands, and create incident
war rooms. Start with [Connect Slack using OAuth](./connect-with-oauth), then
map service destinations.

## Choose a task

- [Connect Slack using OAuth](./connect-with-oauth)
- [Configure service channels](./configure-service-channels)
- [Send and verify a test](./send-test)
- [Understand incident notifications](./incident-notifications)
- [Acknowledge and resolve incidents](./acknowledge-resolve)
- [Use incident actions](./incident-actions) and [commands](./commands)
- [Create and operate war rooms](./war-rooms)
- [Link responder identities](./user-identity-linking)
- [Review permissions and scopes](./permissions-and-scopes)
- [Review rate limits](./rate-limits)
- [Disconnect or reconnect](./disconnect-reconnect)
- [Troubleshoot Slack](./troubleshooting)

## How the pieces relate

The OAuth installation authorizes the OpsKnight bot. Service destinations
control routine lifecycle delivery. Identity links authorize user-attributed
actions. War rooms are separate incident-scoped channels with their own
lifecycle. Configuring one does not implicitly configure the others.
