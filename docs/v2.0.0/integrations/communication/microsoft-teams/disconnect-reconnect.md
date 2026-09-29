---
title: Disconnect or reconnect Microsoft Teams
description: Rotate or replace Teams tenant and Bot credentials while safely revalidating installations, destinations, cards, actions, and war rooms.
type: how-to
product_area: chatops
audience: [administrator]
keywords: [disconnect Teams, reconnect Teams, rotate Bot secret]
reader:
  status: READER_COMPLETE
  task: Disconnect or reconnect Microsoft Teams safely.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/(app)/settings/integrations/microsoft-teams/actions.ts, src/lib/microsoft-teams/]
---

# Disconnect or reconnect Microsoft Teams

## Before you begin

Inventory service destinations, installations, identity links, open war rooms, queued operations, Entra credential expiry, and tenant app policy. Schedule expected ChatOps interruption.

## Open the feature

Open **Settings → Integrations → Microsoft Teams**.

## Configure the change

For credential rotation, keep application/tenant identity stable and create a new Entra client secret. For tenant/application replacement, expect old installations/destinations and queued deliveries to be invalidated and rebuilt.

## Complete the action

1. Record affected resource identities without credentials.
2. Update or disconnect OpsKnight configuration.
3. Update Azure Bot/Entra and generated Teams package as required.
4. Install/approve the current package in target teams.
5. Revalidate destinations, test card, incident card/action, and selected war-room lifecycle.

## What OpsKnight does

Credential/tenant identity changes invalidate stale installation/destination delivery state so old credentials cannot keep sending. The tenant, Bot, package, and OpsKnight configuration must agree.

## Verify it worked

Confirm installation detection, one test card per destination, a normal incident card update, linked-user action, and war-room create/cleanup where enabled.

## Change or undo it

Restore the prior credential only inside its approved rollback window and only if it remains valid. Tenant/app replacement is not safely undone by changing one field; restore all matching components or complete the new configuration.

## Troubleshooting

**Old installation remains:** remove/disable obsolete app installation according to tenant policy and refresh OpsKnight discovery.

**Cards send but actions fail:** verify inbound Bot identity/tenant/service URL and identity mapping.

**War rooms fail after package update:** confirm optional RSC permissions were included and consented in the target team.

## Next steps

- [Send a test](./send-test)
- [Troubleshoot Teams](./troubleshooting)

