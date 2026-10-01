---
title: Troubleshoot Slack
description: Diagnose OAuth, delivery, interactive-action, identity, and war-room failures.
type: troubleshooting
product_area: chatops
audience: [administrator, responder]
reader:
  status: READER_COMPLETE
  task: Diagnose and recover Slack connection, delivery, action, identity, and war-room failures.
keywords: [slack not sending, slack message failed, slack troubleshooting, slack actions failing]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/app/api/slack/, src/lib/chatops/, src/lib/war-room/providers/slack/]
---

# Troubleshoot Slack

## Workspace will not connect

Verify the public application URL, callback URL, Slack app credentials, and
administrator installation permission. Reconnect after a revoked installation.

Check the failed OAuth callback response and OpsKnight logs at the same time. A
redirect mismatch is fixed in the Slack app configuration; invalid client
credentials are fixed in the OpsKnight secret; `access_denied` means the
installer cancelled or lacked workspace permission. Do not rotate the signing
secret to repair an OAuth redirect problem.

## Messages are not delivered

Test the destination, confirm the bot can access the channel, inspect the
notification operation, and check the provider response. A workspace connection
does not grant access to every private channel.

Test the exact service destination, not a different public channel. Distinguish
`channel_not_found` or `not_in_channel` from `missing_scope`, revoked token, and
rate limit responses. Invite the bot to a private destination when required;
reinstall only when the granted scopes actually changed.

## An action or command fails

Confirm request-signature validation, required scopes, identity linking, and the
responder's OpsKnight permissions. Queue failures return a temporary error and
should be retried only after worker health is restored.

Use the Slack request timestamp and interaction payload ID to locate the inbound
request. Signature failures indicate wrong raw bytes, timestamp, or signing
secret. A successful signature followed by forbidden means the linked OpsKnight
user lacks permission. An unlinked Slack identity must complete identity linking;
do not grant a shared administrative identity.

## War-room creation fails

Check `channels:manage`; for private rooms also check the optional `groups:*`
scopes. Inspect the incident collaboration operation before manually creating a
replacement channel.

Before retrying, search Slack and the incident collaboration record for the
requested room. A remote create can succeed even if the callback times out. If
the room exists, reconcile that result instead of creating a duplicate.

## Verify and escalate

Reconnect only when necessary, send one non-production incident notification,
run one authorized action, and create one test war room. Preserve workspace ID,
channel ID, request timestamp, operation ID, Slack error code, and granted scope
list. Redact tokens, signing secrets, and message content containing customer data.
