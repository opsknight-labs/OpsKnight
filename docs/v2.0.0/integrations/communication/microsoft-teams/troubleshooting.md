---
title: Troubleshoot Microsoft Teams
description: Diagnose tenant, installation, destination, card, and war-room failures.
type: troubleshooting
product_area: chatops
audience: [administrator, responder]
reader:
  status: READER_COMPLETE
  task: Diagnose and recover Teams installation, card, action, identity, and war-room failures.
keywords: [Teams not sending cards, Teams card action failing, Teams troubleshooting, Adaptive Cards]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/lib/microsoft-teams/, src/app/api/microsoft-teams/]
---

# Troubleshoot Microsoft Teams

## Installation is not detected

Verify the configured tenant ID, Azure Bot endpoint, application package ID,
and that the bot is installed in the target team.

Separate the Entra application ID, Azure Bot identity, Teams app manifest bot ID,
and configured OpsKnight ID; they must identify the intended application. Confirm
the messaging endpoint is public HTTPS and targets the documented OpsKnight
activity route. A tenant restriction or missing team installation cannot be fixed
by changing the bot secret.

## Cards are not delivered

Test the exact destination. Confirm its installation remains enabled and its
service URL is trusted. Inspect the notification operation and provider result.

Locate the saved conversation/destination by tenant, team, and channel. A stale
service URL or removed installation requires a fresh installation/conversation
update; a forbidden response requires destination/app permission review. Test the
same destination because success in personal chat does not prove team-channel
delivery.

## Card actions return forbidden

Check Bot token validation, tenant match, installation and destination scope,
identity mapping, and OpsKnight authorization. The inbound activity limit is
enforced before processing; oversized requests return `413`.

Match the activity ID and timestamp to the OpsKnight request. Validate the Bot
Framework token issuer/audience and tenant first, then installation scope,
identity mapping, and OpsKnight role. If the card is old, compare its incident
state with the canonical incident; an already completed action should not be
forced through again.

## War-room creation fails

Verify the target team granted the optional war-room RSC permissions. Inspect
the collaboration operation before retrying because channel creation can
succeed remotely even when the response is ambiguous.

Search the target team before retrying. If a channel already exists, reconcile
the collaboration operation. If no channel exists, distinguish missing resource-
specific consent, insufficient Graph permission, team policy, naming conflict,
and provider throttling.

## Verify and escalate

Use a non-production service to post a normal incident card and a war-room card,
run one action as a linked responder, and create one test room. Preserve tenant,
team, channel, activity, and operation IDs plus HTTP status and Microsoft error
code. Never attach bot credentials, bearer tokens, or an unredacted card payload.
