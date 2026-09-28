---
title: Configure Slack service channels
description: Route service incident messages to one or more Slack destinations.
type: how-to
product_area: chatops
audience: [administrator]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/app/api/slack/destinations/route.ts]
---

# Configure Slack service channels

## Before you begin

Connect the Slack workspace and ensure the bot can access each target channel.

1. Open **Services → your service → Notifications**.
2. Enable Slack and select a connected workspace channel.
3. Add up to three active channels for the service.
4. Use **Test** for every destination, then save.

All linked channels receive lifecycle messages; they are not a fallback chain.
At the three-channel limit, unlink an obsolete channel before adding another.
Channel destinations are independent from incident war rooms and user identity
links.

## Verify

Trigger a synthetic incident. Confirm exactly one message in every mapped
channel and verify that later lifecycle changes update the existing projection.
