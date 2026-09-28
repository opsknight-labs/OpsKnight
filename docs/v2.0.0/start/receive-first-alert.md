---
title: Receive your first alert
description: Connect an alert source and verify incident creation safely.
type: tutorial
product_area: getting-started
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/app/api/integrations/, src/lib/integrations/handler.ts]
---

# Receive your first alert

## Before you begin

Create a service and obtain permission to configure webhooks in the alert provider.

1. Open **Services → your service → Integrations**.
2. Add your monitoring provider, or choose the generic webhook.
3. Copy the generated webhook URL and integration key.
4. Configure a non-production alert in the provider.
5. Send one trigger event.
6. Open **Incidents** and confirm the incident belongs to the intended service.
7. Send a recovery event and verify the existing incident converges instead of
   creating an unrelated incident when the adapter supports recovery.

Use the [integration catalog](../integrations/) for provider-specific event
mapping, security, limits, and troubleshooting.
