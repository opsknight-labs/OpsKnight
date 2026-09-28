---
title: Slack permissions and scopes
description: Understand the exact required and optional Slack bot scopes.
type: reference
product_area: chatops
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/lib/slack/app-manifest.ts]
---

# Slack permissions and scopes

Core features require `chat:write`, `channels:read`, `channels:join`,
`channels:manage`, `channels:history`, `reactions:read`, `users:read`, and
`users:read.email`.

Private-channel and direct-message coverage is optional and uses `groups:read`,
`groups:write`, `groups:history`, `im:read`, and `mpim:read`. OpsKnight also
registers the `reaction_added`, `app_uninstalled`, and `tokens_revoked` events,
the `/incident` command, and signed interactivity endpoints.

The generated app manifest, OAuth request, and settings health check all use
the same source-owned scope lists.
