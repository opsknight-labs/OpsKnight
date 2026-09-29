---
title: Link Microsoft Teams responder identities
description: Map a verified Teams user to the correct OpsKnight responder for authorized and attributable incident actions.
type: how-to
product_area: chatops
audience: [responder, administrator]
keywords: [Teams identity linking, responder identity]
reader:
  status: READER_COMPLETE
  task: Link and verify a Microsoft Teams responder identity.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/api/settings/chatops/identities/route.ts, src/lib/chatops/intents.ts, src/lib/microsoft-teams/]
---

# Link Microsoft Teams responder identities

## Before you begin

Sign in to OpsKnight as the active responder whose Teams identity is being linked. Never complete another person's link.

## Open the feature

Select an incident action in Teams and follow the identity-link prompt, or open **Settings → ChatOps identity** in OpsKnight.

## Configure the identity

Confirm the tenant/account shown is your own and that the OpsKnight session is your intended responder account.

## Complete the action

1. Open the signed link prompt.
2. Complete it while authenticated to OpsKnight as yourself.
3. Return to the original Teams card.
4. Retry the incident action once.

## What OpsKnight does

OpsKnight stores a tenant/provider identity mapping to the responder. It still applies current authorization, service scope, and incident-state rules to each action.

## Verify it worked

Perform an allowed test action and confirm the incident timeline attributes it to your OpsKnight account. Confirm all cards converge.

## Remove or change the link

Remove stale mappings when a Teams account or OpsKnight user is deactivated or ownership changes, then complete a new signed link. Never transfer a link URL.

## Troubleshooting

**Prompt repeats:** verify tenant/account and OpsKnight session match and the user is active.

**Linked but forbidden:** identity succeeded; check product role/capability/service scope and incident state.

**Wrong actor appears:** stop actions, remove the mapping, review audit/timeline, and relink the correct account.

## Next steps

- [Use incident actions](./incident-actions)
- [Troubleshoot Teams](./troubleshooting)

