---
title: Slack
description: Configure Slack destinations, incident messages, and war rooms.
type: integration
product_area: chatops
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/slack/app-manifest.ts
    - src/lib/war-room/providers/slack/adapter.ts
---

# Slack

Slack supports configured destinations and provider-backed incident war rooms.
Install the app with the generated manifest or configured OAuth flow, verify the
workspace, map destinations to services, and test with a synthetic incident.

The integration must validate Slack signatures and timestamps for inbound
requests. Store bot and signing secrets encrypted. Confirm message projection,
interactive actions, participant reconciliation, and terminal room cleanup.

When diagnosing a failure, separate OAuth installation, destination mapping,
provider API response, identity linking, and war-room lifecycle state.

