---
title: Slack permissions and scopes
order: 3
description: Understand the exact required and optional Slack bot scopes, including the commands scope added in 2.2.0.
type: reference
product_area: chatops
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-11-27
  evidence:
    - src/lib/slack/app-manifest.ts
    - src/lib/slack/health.ts
    - src/components/settings/slack/SlackHealthPanel.tsx
    - tests/lib/slack-app-manifest.test.ts
---

# Slack permissions and scopes

Core features require `chat:write`, `channels:read`, `channels:join`,
`channels:manage`, `channels:history`, `reactions:read`, `users:read`,
`users:read.email`, and `commands`.

Private-channel and direct-message coverage is optional and uses `groups:read`,
`groups:write`, `groups:history`, `im:read`, and `mpim:read`. Squire, the
OpsKnight assistant, uses two more optional scopes: `app_mentions:read` (receive
`@OpsKnight` mentions) and `chat:write.customize` (described below). OpsKnight
also registers the `reaction_added`, `app_mention`, `app_uninstalled`, and
`tokens_revoked` events, the `/incident` command, and signed interactivity
endpoints.

Four more optional scopes switch on features. Without them OpsKnight skips the feature quietly; nothing else changes:

| Scope | What it enables |
| --- | --- |
| `chat:write.public` | Post to a public channel without inviting the bot first. |
| `pins:write` | Pin the status card in war rooms. |
| `bookmarks:write` | Bookmark the incident in war-room channels. |
| `im:write` | Page responders with a Slack direct message (see [identity linking](./user-identity-linking)). |

The generated app manifest, OAuth request, and settings health check all use
the same source-owned scope lists.

## Squire's name and avatar (`chat:write.customize`)

Slack lets an app post under a different name and icon only when it holds
`chat:write.customize`. With the scope granted, every Squire message (answers to
`@OpsKnight` mentions and Squire's automatic incident-channel updates) is posted
under the Squire name set in **Settings → Intelligence → AI** and the Squire
avatar served from your OpsKnight base URL (`/squire/squire-avatar.png`).

Without the scope, Squire still works: its messages post as **OpsKnight** and
start with a one-line header, "Squire · OpsKnight assistant", with the avatar
when your base URL is a public `https` address. Microsoft Teams cannot change a
bot's sender, so Teams always shows that header.

The scope changes only how Squire's messages are labelled. Alerts, paging
messages, and the war-room card always post as **OpsKnight**, with or without
it. To grant it on an existing workspace, add `chat:write.customize` under
**OAuth & Permissions → Bot Token Scopes** (or recreate the app from the new
manifest), then select **Reconnect to refresh scopes** in OpsKnight. The scope
checklist shows it as **Optional** until it is granted.

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

Other Slack setup is unchanged; see
[Connect Slack with OAuth](./connect-with-oauth.md).

## Update an existing install

If the Slack app was installed from an older manifest, **Settings → Integrations → Slack** shows **Slack app manifest out of date** with the scopes it is missing and what each one unlocks. Everything that worked before keeps working; those features stay off until you update the app:

1. Select **Copy manifest**, open your app in the Slack API console, paste it under **App Manifest**, and save.
2. Select **Reconnect Slack** in OpsKnight and approve the new scopes.

When the grant is complete the notice disappears and the **Bot permissions** tile shows every scope granted. A missing *required* scope is shown as a critical warning with the same **Reconnect Slack** button.
