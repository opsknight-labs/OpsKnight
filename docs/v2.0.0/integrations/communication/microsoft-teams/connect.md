---
title: Connect Microsoft Teams
description: Register the Entra and Azure Bot resources and install the generated Teams package.
type: how-to
product_area: chatops
audience: [administrator]
keywords: [connect Teams, Microsoft Teams setup, Azure Bot, Entra app, Teams app package]
reader:
  status: READER_COMPLETE
  task: Register, connect, install, and validate Microsoft Teams ChatOps.
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/lib/microsoft-teams/app-manifest.ts, src/app/(app)/settings/integrations/microsoft-teams/actions.ts]
---

# Connect Microsoft Teams

## Before you begin

You need OpsKnight administrator access, an Entra application and client secret,
an Azure Bot resource, the target tenant ID, and permission to install a custom
Teams application.

## Open the feature

Open **Settings → Integrations → Microsoft Teams**. OpsKnight uses one configured Entra tenant, Azure Bot messaging endpoint, and installed Teams application package.

## Configure Entra and Azure Bot

1. In Entra, create/select the application and client credential approved for the bot integration. Record the application ID, secret value, and tenant ID securely.
2. In Azure Bot, associate the application identity and set the messaging endpoint to `https://YOUR_OPSKNIGHT_HOST/api/microsoft-teams/messages`.
3. In OpsKnight, enter the Entra application ID, client secret, and tenant ID. The current
   settings workflow requires a single tenant.
4. Save and download the generated Teams application package.
5. Install or approve the package in the configured tenant and target team according to tenant policy.
6. Return to OpsKnight and confirm an enabled installation is visible.

## What OpsKnight does

OpsKnight stores the application credential encrypted, validates inbound Bot activities, discovers tenant-scoped installations/destinations, and sends Adaptive Cards through Bot Framework Connector transport. Changing client or tenant identity invalidates old installations, destinations, and queued deliveries so stale credentials cannot continue sending.

## Verify the connection

1. Confirm the settings page shows the intended tenant/application and an enabled installation.
2. [Configure a non-production destination](./configure-destinations).
3. [Send a test card](./send-test).
4. Trigger a synthetic incident and verify the normal card lifecycle.
5. Perform one identity-linked action.

## Disconnect or reconnect

Use [Disconnect and reconnect Teams](./disconnect-reconnect). Coordinate OpsKnight configuration, tenant app installation, Bot credential rotation, and destination revalidation; changing only one side causes partial failure.

## Troubleshooting

**Installation is not detected:** verify tenant ID, app package identity, Bot installation in the team, and messaging endpoint reachability.

**Inbound messages fail:** inspect Bot token validation, application identity, tenant, trusted service URL, request size, and public TLS.

**Package cannot install:** resolve tenant custom-app policy or administrator approval; do not sideload around production governance.

## Next steps

- [Configure service destinations](./configure-destinations)
- [Review permissions](./permissions)
- [Configure war rooms](./war-rooms)
