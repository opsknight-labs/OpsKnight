---
title: Troubleshoot Slack
description: Diagnose OAuth, delivery, interactive-action, identity, and war-room failures.
type: troubleshooting
product_area: chatops
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/app/api/slack/, src/lib/chatops/, src/lib/war-room/providers/slack/]
---

# Troubleshoot Slack

## Workspace will not connect

Verify the public application URL, callback URL, Slack app credentials, and
administrator installation permission. Reconnect after a revoked installation.

## Messages are not delivered

Test the destination, confirm the bot can access the channel, inspect the
notification operation, and check the provider response. A workspace connection
does not grant access to every private channel.

## An action or command fails

Confirm request-signature validation, required scopes, identity linking, and the
responder's OpsKnight permissions. Queue failures return a temporary error and
should be retried only after worker health is restored.

## War-room creation fails

Check `channels:manage`; for private rooms also check the optional `groups:*`
scopes. Inspect the incident collaboration operation before manually creating a
replacement channel.

