---
title: Use Slack incident actions
description: Acknowledge, resolve, annotate, and inspect incidents from Slack.
type: concept
product_area: chatops
audience: [responder]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/app/api/slack/actions/route.ts, src/lib/chatops/slash-commands.ts, src/lib/slack/app-manifest.ts]
---

# Use Slack incident actions

This page summarizes the supported action surface. Follow [Acknowledge and resolve incidents](./acknowledge-resolve) for lifecycle effects and [Slack incident commands](./commands) for exact slash-command behavior.

## Before you begin

Connect Slack, map a service destination, and link your responder identity.

Interactive messages expose only actions allowed by the shared ChatOps policy.
Link your Slack identity before performing user-attributed actions.

1. Open the incident message or incident war-room channel.
2. Use an available message action, or enter `/incident` with one of these commands:

- `ack`
- `resolve [summary]`
- `note <message>`
- `who`
- `postmortem`
- `help`

3. Confirm the incident timeline and Slack message show the resulting state.

After an action, confirm the OpsKnight incident timeline and the original Slack
message converge on the same state. Inbound actions require valid Slack request
signatures and timestamps and still pass OpsKnight authorization checks.
