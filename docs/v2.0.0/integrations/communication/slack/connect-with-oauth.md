---
title: Connect Slack using OAuth
description: Install or reconnect the OpsKnight Slack app and verify the workspace.
type: how-to
product_area: chatops
audience: [administrator]
keywords: [slack oauth, connect slack, slack integration, slack app, rotate slack credential]
reader:
  status: READER_COMPLETE
  task: Connect and validate a Slack workspace using OAuth.
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

## Open the feature

Open **Settings → Integrations → Slack**. The page shows whether a workspace is disconnected, connected, missing required scopes, or needs reconnection.

## Configure Slack OAuth

1. Open **Settings → Integrations → Slack**.
2. Select **Connect Slack**.
3. On Slack's authorization page, review the workspace and requested scopes.
4. Select **Allow**.
5. Return to OpsKnight and confirm that the workspace is connected and the
   required-scope check passes.

Do not continue if Slack shows the wrong workspace or unexpected permissions. Return without authorizing and start again from the intended tenant.

## What OpsKnight does

The callback validates the OAuth state, stores the Slack workspace identity and granted scopes, and encrypts the bot credential. A connection authorizes the workspace; it does not grant access to every private channel and does not configure any service destination.

## Verify the connection

1. Confirm the settings page names the intended workspace and reports required scopes present.
2. Open [Configure service channels](./configure-service-channels) and add a non-production channel.
3. [Send a test](./send-test) and confirm the message appears in that exact channel.
4. Trigger a synthetic incident and confirm the lifecycle projection updates rather than creating an unrelated duplicate.

A successful callback without channel delivery does not pass verification.

## Disconnect or reconnect

Use [Disconnect and reconnect](./disconnect-reconnect). Revoking the Slack app or token makes existing destinations unavailable until a valid workspace connection is restored. Reconnection does not prove previously private channels remain accessible.

## Troubleshooting

**Slack returns to an error page:** verify public `NEXTAUTH_URL`, callback reachability, client identity/secret, OAuth state/session, and exact redirect URI.

**Workspace connects with missing scopes:** reinstall/re-authorize with the current generated manifest and recheck health.

**Workspace connects but a channel is unavailable:** invite the bot or grant the optional private-channel scopes as appropriate; do not assume workspace installation grants channel membership.

## Next steps

- [Configure service channels](./configure-service-channels)
- [Link responder identities](./user-identity-linking)
- [Review scopes](./permissions-and-scopes)
