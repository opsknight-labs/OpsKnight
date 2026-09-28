---
title: Link Slack responder identities
description: Associate a Slack user with an OpsKnight responder account.
type: how-to
product_area: chatops
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/app/api/settings/chatops/identities/route.ts, src/lib/chatops/intents.ts]
---

# Link Slack responder identities

## Before you begin

Sign in to OpsKnight as the responder whose Slack account you are linking.

Identity linking attributes Slack actions to the correct OpsKnight user. Follow
the identity-link prompt from Slack or **Settings → ChatOps identity**.

1. Open your identity-link prompt.
2. Complete the signed flow while authenticated as yourself.
3. Retry the Slack action.
4. Verify the OpsKnight timeline attributes the action to your account.

Never share an identity-link URL. Administrators should remove stale mappings
when a Slack account or OpsKnight user is deactivated.
