---
title: ChatOps and war rooms
description: Provider-backed collaboration spaces linked to incidents.
type: concept
product_area: chatops
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/war-room/, src/lib/slack.ts]
---

# ChatOps and war rooms

War rooms project incident state into supported collaboration providers. The
incident remains authoritative; provider messages and membership are managed
projections with reconciliation and cleanup behavior.

Provisioning creates or links a provider room, stores its durable identity, and
publishes incident updates with idempotent delivery keys. Provider rate limits,
permission changes, and deleted rooms can make the projection temporarily
unavailable without changing the incident itself.

Treat room membership and message history according to the provider's retention
and access controls. Archive or reconcile rooms through OpsKnight so internal
links and provider state do not diverge.
