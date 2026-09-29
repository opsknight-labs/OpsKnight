---
title: Configure Slack service channels
description: Route service incident messages to one or more Slack destinations.
type: how-to
product_area: chatops
audience: [administrator]
reader:
  status: READER_COMPLETE
  task: Route a service's incident lifecycle to Slack channels.
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/app/api/slack/destinations/route.ts]
---

# Configure Slack service channels

## Before you begin

Connect the Slack workspace and ensure the bot can access each target channel.

## Open the feature

Open **Services → select the service → Notifications → Slack**. Workspace connection and service routing are separate: this page chooses where that service sends incident messages.

## Configure destinations

1. Enable Slack delivery for the service.
2. Select a connected workspace channel.
3. Add up to three active channels for the service.
4. Save the service configuration.
5. Use **Test** for every destination.

All linked channels receive lifecycle messages; they are not a fallback chain.
At the three-channel limit, unlink an obsolete channel before adding another.
Channel destinations are independent from incident war rooms and user identity
links.

## What OpsKnight does

All active destinations receive lifecycle messages; they are not a priority or fallback chain. OpsKnight stores durable destination identities and updates the incident projection as state changes. Routine service channels are separate from incident war rooms and identity links.

## Verify it worked

Trigger a synthetic incident. Confirm exactly one message in every mapped
channel and verify that later lifecycle changes update the existing projection.

## Remove or change a destination

Open the same service page, unlink the obsolete destination, save, and send tests to the remaining destinations. Removing a routine destination does not close an existing war room. At the three-channel limit, remove an obsolete channel before adding another.

## Troubleshooting

**Channel does not appear:** confirm the bot can discover/access it and that required public/private scopes and membership are present.

**Test succeeds but incidents do not arrive:** check service notification routing and the incident's service, then inspect delivery history/provider result.

**Duplicate messages:** confirm the channel is not mapped through multiple active destinations and inspect the incident delivery/projection IDs before retrying.

## Next steps

- [Send and interpret a test](./send-test)
- [Understand incident notifications](./incident-notifications)
- [Use incident actions](./incident-actions)
