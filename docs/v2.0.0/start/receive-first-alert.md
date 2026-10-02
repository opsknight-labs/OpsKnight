---
title: Receive your first alert
description: Connect a generic webhook, send a safe trigger, and verify incident correlation.
type: tutorial
product_area: getting-started
audience: [administrator, operator]
reader:
  status: READER_COMPLETE
  task: Connect a generic webhook and verify trigger, deduplication, and recovery behavior.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/app/(app)/services/actions.ts
    - src/app/api/integrations/webhook/route.ts
    - src/lib/integrations/webhook.ts
---

# Receive your first alert

Use the generic webhook for the first end-to-end test. Once the route works, replace it with the provider-specific integration used in production.

## Before you begin

Complete [Configure on-call](./configure-on-call). Use a non-production service and a test responder; this procedure intentionally starts paging.

## 1. Create the integration

1. Open **Services → your service → Integrations**.
2. Select **Add integration**, then **Generic Webhook**.
3. Enter a recognizable name such as `Quickstart webhook` and create it.
4. Copy the generated webhook URL and integration key from the service page.

Treat the key as a credential. Do not paste it into tickets, chat, source control, or screenshots. The URL includes the integration identifier; authentication still requires the matching key.

## 2. Send a trigger

Configure your test sender to issue `POST` to the copied URL. Supply the key using the exact transport displayed by OpsKnight; `Authorization: Bearer <key>` is supported. Send a representative trigger payload from the [Generic webhook guide](../integrations/webhooks/webhook).

The body must be valid JSON and no larger than 1 MiB. The integration permits 100 requests per 60 seconds. Do not retry a validation error in a tight loop.

## 3. Verify the incident

Open **Incidents** and select the new incident. Confirm:

- the incident belongs to the intended service;
- the title and source match the test event;
- its timeline contains the trigger;
- the escalation policy started;
- the current responder received the expected personal notification.

If no incident appears, open **Settings → Integrations → Failures**. A `400` indicates invalid input, `401` a disabled or mismatched integration/key, `404` an unknown integration, `413` an oversized body, `429` rate limiting, and `503` an equivalent delivery already in progress.

## 4. Test correlation and recovery

Send the same logical alert again using the same provider correlation identity. It should update or converge on the existing incident rather than create unrelated incidents. Then send the adapter's recovery action and verify that the correlated incident resolves.

Keep the trigger/recovery identity identical. Changing it creates a different correlation stream and may legitimately create another incident.

For a production provider, follow its page in the [integration catalog](../integrations/) and repeat this trigger/recovery test before enabling real monitors.

## Troubleshooting

**401 Unauthorized:** recopy the key, check the authentication header, and confirm the integration is enabled and belongs to the URL's service.

**A duplicate incident appears:** compare the correlation identity in both payloads. Retries must preserve the provider event or alert identity.

**The incident appears but nobody is notified:** recheck service → policy → matching step → schedule coverage → responder preference → provider health. Use [Notification troubleshooting](../troubleshooting/notifications/not-delivered).

**Recovery creates another incident:** the recovery payload did not preserve the trigger's correlation identity or used an unsupported state mapping.

Continue with [Respond to your first incident](./respond-first-incident).
