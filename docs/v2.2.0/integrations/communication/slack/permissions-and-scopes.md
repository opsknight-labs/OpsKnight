---
title: Slack permissions and scopes
order: 3
description: Understand the exact required and optional Slack bot scopes, including the commands scope added in 2.2.0.
type: reference
product_area: chatops
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-11-19
  evidence: [src/lib/slack/app-manifest.ts, tests/lib/slack-app-manifest.test.ts]
---

# Slack permissions and scopes

Core features require `chat:write`, `channels:read`, `channels:join`,
`channels:manage`, `channels:history`, `reactions:read`, `users:read`,
`users:read.email`, and `commands`.

Private-channel and direct-message coverage is optional and uses `groups:read`,
`groups:write`, `groups:history`, `im:read`, and `mpim:read`. OpsKnight also
registers the `reaction_added`, `app_uninstalled`, and `tokens_revoked` events,
the `/incident` command, and signed interactivity endpoints.

The generated app manifest, OAuth request, and settings health check all use
the same source-owned scope lists.

## What changed in 2.2.0

`commands` is now a required scope. Slack rejects an app manifest that declares
a slash command without it, and a workspace installed without it does not
deliver `/incident` to OpsKnight. Earlier releases declared `/incident` but did
not request the scope.

## Upgrading from 2.1

Workspaces connected on 2.1 show `commands` as a missing required scope under
**Settings → Integrations → Slack**. To fix it:

1. If you created the Slack app from the manifest, add `commands` under
   **OAuth & Permissions → Bot Token Scopes** in the Slack app settings, or
   recreate the app from the new manifest.
2. Select **Reconnect to refresh scopes** in OpsKnight and approve the updated
   scopes.
3. Run `/incident help` in a channel the bot is in to confirm the command
   reaches OpsKnight.

Other Slack setup is unchanged; see the
[2.1.0 Slack guide](../../../../v2.1.0/integrations/communication/slack/connect-with-oauth.md).
