---
title: Disconnect or reconnect Slack
description: Rotate or revoke a Slack workspace connection and safely revalidate destinations, identities, actions, and war rooms.
type: how-to
product_area: chatops
audience: [administrator]
keywords: [disconnect Slack, reconnect Slack, rotate Slack token]
reader:
  status: READER_COMPLETE
  task: Disconnect or reconnect a Slack workspace safely.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/api/slack/oauth/route.ts, src/app/api/slack/oauth/callback/route.ts, src/lib/slack.ts]
---

# Disconnect or reconnect Slack

## Before you begin

Use an administrator account and schedule the change when delayed ChatOps delivery is acceptable. Inventory active service destinations, identity links, open war rooms, and queued operations.

## Open the feature

Open **Settings → Integrations → Slack** and select the connected workspace.

## Configure the change

Choose reconnection for revoked/rotated authorization or required-scope changes. Choose disconnection when Slack must stop receiving OpsKnight data. Coordinate app revocation in Slack so neither side is assumed active incorrectly.

## Complete the action

1. Record affected destinations/open incidents without recording credentials.
2. Select the disconnect/reconnect control.
3. For reconnect, complete OAuth in the intended workspace and review scopes.
4. Re-run workspace health and destination tests.
5. Trigger one synthetic incident and action.

## What OpsKnight does

OpsKnight replaces/stores encrypted authorization and workspace identity after a validated callback. Stale/revoked authorization cannot deliver. Existing destination identifiers still require access and must be retested.

## Verify it worked

For disconnect, confirm tests/delivery no longer succeed and remove obsolete routing. For reconnect, confirm required scopes, every production destination, an interactive action, and selected war-room lifecycle.

## Change or undo it

Reconnect through OAuth to restore a deliberately disconnected workspace. If the wrong workspace was connected, disconnect it before authorizing the correct one; do not leave ambiguous cross-workspace routing.

## Troubleshooting

**Old workspace appears:** clear the admin Slack session or explicitly choose the correct workspace during OAuth.

**Destinations fail after reconnect:** verify bot membership/channel identity and newly granted optional scopes.

**Queued failures persist:** inspect whether operations are retryable or terminal after credential replacement; avoid uncontrolled replay.

## Next steps

- [Send a test](./send-test)
- [Troubleshoot Slack](./troubleshooting)

