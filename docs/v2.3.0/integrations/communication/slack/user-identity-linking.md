---
title: Link Slack responder identities
order: 9
description: Associate a Slack user with an OpsKnight responder account.
type: how-to
product_area: chatops
audience: [responder, administrator]
reader:
  status: READER_COMPLETE
  task: Link and verify a Slack responder identity.
verification:
  level: source
  verified_at: 2026-11-27
  evidence:
    - src/app/api/settings/chatops/identities/route.ts
    - src/lib/chatops/intents.ts
    - src/lib/slack/dm.ts
    - src/components/settings/NotificationPreferencesForm.tsx
---

# Link Slack responder identities

## Before you begin

Sign in to OpsKnight as the responder whose Slack account you are linking.

## Open the feature

Select an incident action in Slack and follow the identity-link prompt, or open **Settings → Profile & Preferences** (`/settings/profile`) and locate **Connected ChatOps Accounts**.

## Configure the identity

Confirm the Slack workspace/user and signed-in OpsKnight account are your own. Identity linking attributes actions; it does not grant product permission.

## Complete the action

1. Open your identity-link prompt.
2. Complete the signed flow while authenticated as yourself.
3. Retry the Slack action.
4. Verify the OpsKnight timeline attributes the action to your account.

## What OpsKnight does

OpsKnight stores the provider/workspace/user mapping and still evaluates current role, service scope, action policy, and incident state for every request.

## Verify it worked

Perform an allowed action on a controlled incident. Confirm actor attribution in the OpsKnight timeline and convergence of every Slack projection.

## Remove or change the link

Administrators should remove stale mappings when a Slack account or OpsKnight user is deactivated or ownership changes, then complete a new signed link. Never share an identity-link URL.

## Troubleshooting

**Prompt repeats:** confirm the signed link was completed while authenticated as the matching active OpsKnight account.

**Linked but forbidden:** identity succeeded; check OpsKnight permissions/service scope and current incident state.

**Wrong actor:** stop actions, remove the mapping, review timeline/audit evidence, and link the correct account.

## Next steps

- [Acknowledge and resolve](./acknowledge-resolve)
- [Use commands](./commands)

## Optional: Slack direct-message paging

A responder can also be paged by Slack direct message, with **Acknowledge** and **Resolve** buttons. It is off for everyone until each person opts in at **Settings → Profile & Preferences → Notifications → Slack DM**. It needs the `im:write` scope on the Slack app (see [permissions and scopes](./permissions-and-scopes)), and the OpsKnight account email must match the Slack account email so OpsKnight can find you. The switch stays disabled, with the reason, until the app has the scope.
