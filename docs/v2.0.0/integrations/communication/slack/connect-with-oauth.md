---
title: Connect Slack using OAuth
description: Install or reconnect the OpsKnight Slack app and verify the workspace.
type: how-to
product_area: chatops
audience: [administrator]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/app/api/slack/oauth/route.ts, src/app/api/slack/oauth/callback/route.ts, src/lib/slack/app-manifest.ts]
---

# Connect Slack using OAuth

Slack OAuth connects an OpsKnight workspace to a Slack workspace without asking
an administrator to copy a bot token into OpsKnight.

## Before you begin

- Use an OpsKnight administrator account.
- Have permission to install apps in the target Slack workspace.
- Configure the externally reachable OpsKnight application URL.

## Connect the workspace

1. Open **Settings → Integrations → Slack**.
2. Select **Connect Slack**.
3. On Slack's authorization page, review the workspace and requested scopes.
4. Select **Allow**.
5. Return to OpsKnight and confirm that the workspace is connected and the
   required-scope check passes.

The callback stores the workspace identity, granted scopes, and encrypted bot
credentials. If an administrator revokes the Slack installation, reconnect it
from the same settings page before testing destinations.

## Verify

Continue to [Configure service channels](./configure-service-channels), link a
non-production channel, and send a test message. A successful OAuth callback
alone does not prove the bot can access a particular channel.
