---
title: Connect Microsoft Teams
description: Register the Entra and Azure Bot resources and install the generated Teams package.
type: how-to
product_area: chatops
audience: [administrator]
keywords: [connect Teams, Microsoft Teams setup, Azure Bot, Entra app, Teams app package]
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

## Configure

1. Open **Settings → Integrations → Microsoft Teams**.
2. Enter the Entra application ID, client secret, and tenant ID. The current
   settings workflow requires a single tenant.
3. Configure the Azure Bot messaging endpoint as
   `https://YOUR_OPSKNIGHT_HOST/api/microsoft-teams/messages`.
4. Download the generated Teams application package and install it in the
   configured tenant.
5. Return to OpsKnight and confirm an enabled installation is visible.

Changing the client or tenant identity invalidates old installations,
destinations, and queued deliveries so stale credentials cannot keep sending.
