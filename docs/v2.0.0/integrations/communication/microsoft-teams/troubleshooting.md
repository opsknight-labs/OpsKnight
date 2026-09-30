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

## Cards are not delivered

Test the exact destination. Confirm its installation remains enabled and its
service URL is trusted. Inspect the notification operation and provider result.

## Card actions return forbidden

Check Bot token validation, tenant match, installation and destination scope,
identity mapping, and OpsKnight authorization. The inbound activity limit is
enforced before processing; oversized requests return `413`.

## War-room creation fails

Verify the target team granted the optional war-room RSC permissions. Inspect
the collaboration operation before retrying because channel creation can
succeed remotely even when the response is ambiguous.
