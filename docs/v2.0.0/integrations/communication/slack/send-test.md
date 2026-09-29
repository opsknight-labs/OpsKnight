---
title: Send and verify a Slack test
description: Test an exact Slack service destination and distinguish workspace, channel-access, queue, and delivery failures.
type: how-to
product_area: chatops
audience: [administrator, operator]
keywords: [Slack test, test message, destination health]
reader:
  status: READER_COMPLETE
  task: Send and verify a Slack destination test.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/api/slack/destinations/route.ts, src/lib/slack.ts]
---

# Send and verify a Slack test

## Before you begin

Connect Slack and save a destination on a non-production service. Ensure the bot is a member of a private target channel.

## Open the feature

Open **Services → select the service → Notifications → Slack**, then locate the exact saved destination.

## Configure the test

Confirm the displayed workspace and channel are the intended destination. Do not use a production incident channel for the first test.

## Complete the action

1. Select **Test** for the destination.
2. Wait for the operation result; do not click repeatedly.
3. Open the target Slack channel.
4. Match the received test to the destination and test time.

## What OpsKnight does

The test uses the stored encrypted workspace credential and selected channel. It validates delivery to that destination, not incident routing, identity linking, interactive actions, or war-room permissions.

## Verify it worked

The OpsKnight operation reports success and exactly one test message appears in the selected channel. Then trigger a synthetic incident to validate service routing and lifecycle updates.

## Remove the test setup

Delete the test message according to workspace policy and unlink the non-production destination if it was temporary.

## Troubleshooting

**Channel not found/forbidden:** verify channel identity, bot membership, and public/private scopes.

**Rate limited:** wait for the provider retry window; do not generate repeated tests. Inspect operation/provider response.

**OpsKnight reports success but message is not visible:** verify the exact workspace/channel, Slack retention/moderation, and that another destination was not inspected.

## Next steps

- [Understand incident notifications](./incident-notifications)
- [Use incident actions](./incident-actions)

