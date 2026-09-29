---
title: Send and verify a Microsoft Teams test
description: Test an exact Teams destination and diagnose installation, channel, Bot transport, or delivery failures.
type: how-to
product_area: chatops
audience: [administrator, operator]
keywords: [Teams test card, Adaptive Card test]
reader:
  status: READER_COMPLETE
  task: Send and verify a Microsoft Teams destination test.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/api/microsoft-teams/test/route.ts, src/lib/microsoft-teams/]
---

# Send and verify a Microsoft Teams test

## Before you begin

Complete tenant/Bot/app installation and save a non-production service destination.

## Open the feature

Open **Services → select the service → Notifications → Microsoft Teams** and locate the exact destination.

## Configure the test

Confirm tenant, team, and channel. Do not use a production incident channel for the first test.

## Complete the action

1. Select **Test** for the destination.
2. Wait for the operation result; avoid repeated clicks.
3. Open the target Teams channel.
4. Match the received Adaptive Card to the test time/destination.

## What OpsKnight does

The test uses the stored tenant installation, trusted service URL, and Bot Framework Connector transport. It proves basic card delivery to one destination, not incident routing, identity-linked actions, or war-room channel permissions.

## Verify it worked

OpsKnight reports success and exactly one test card appears in the intended channel. Then trigger a synthetic incident to validate real lifecycle delivery/update.

## Remove the test setup

Remove the temporary destination after validation if it is not part of production routing. Follow tenant retention policy for the test card.

## Troubleshooting

**Installation not found:** confirm bot/app is installed and enabled in the exact tenant/team.

**Forbidden/untrusted service URL:** re-establish a valid installation/conversation and inspect tenant/service URL validation.

**Timeout/ambiguous response:** inspect delivery operation and channel before retrying to avoid duplicates.

## Next steps

- [Understand incident cards](./incident-notifications)
- [Use incident actions](./incident-actions)

