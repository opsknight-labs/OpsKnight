---
title: Connect Azure Monitor
description: Route Azure Monitor alert-rule firings and resolutions through an action-group webhook to OpsKnight.
type: integration
product_area: integrations
audience: [administrator, operator]
keywords: [Azure Monitor webhook, Azure action group, common alert schema, Azure alerts]
reader:
  status: READER_COMPLETE
  task: Connect, test, and operate an Azure Monitor action-group webhook.
verification:
  level: source
  verified_at: 2026-09-30
  evidence: [src/lib/integrations/azure.ts, src/app/api/integrations/azure/route.ts, src/lib/integrations/auth.ts]
---

# Connect Azure Monitor

Azure Monitor sends an HTTPS webhook from an action group. OpsKnight turns `Fired` or `Activated` into a trigger and any other monitor condition into a resolution, using the Azure alert ID to update the same incident.

## Prerequisites

- An OpsKnight service you can manage and an Azure role permitted to create action groups and edit alert rules.
- A public HTTPS OpsKnight origin with a certificate Azure trusts. Azure webhook actions cannot reach a private endpoint.
- A non-production Azure resource or alert rule whose condition you can safely trigger and clear.

The generated URL contains the integration ID and key. Treat the entire URL as a credential: keep it out of tickets, chat, shell history, and screenshots.

## Setup and configuration

### Create the OpsKnight endpoint

1. Open **Services → your service → Integrations**.
2. Select **Add integration → Azure Monitor**, enter a recognizable name, and save.
3. Copy the complete webhook URL. Do not remove or retype either query parameter.

### Create the Azure action group

1. In the Azure portal, open **Monitor → Alerts → Action groups → Create**.
2. Select the subscription and resource group, then give the action group a durable name and short display name.
3. Open **Actions**, choose **Webhook**, and name the receiver, for example `OpsKnight checkout production`.
4. Paste the complete OpsKnight URL into **URI**.
5. Set **Enable the common alert schema** to **Yes**. OpsKnight understands selected older shapes, but the common schema gives consistent IDs and lifecycle fields across Azure alert types.
6. Select **OK → Review + create → Create**.

Use the ordinary **Webhook** action. Azure **Secure webhook** requires a Microsoft Entra-protected API; this endpoint authenticates with its generated OpsKnight key.

### Attach the action group to an alert rule

1. Open **Monitor → Alerts → Alert rules**, then create or edit the intended rule.
2. In **Actions**, select **Use action groups** and select the new group.
3. Review severity, evaluation frequency, resolve behavior, scope, and rule name.
4. Save the alert rule.

## Verify the connection

1. Open the action group and select **Test**. Choose a sample compatible with the alert type and send it.
2. Confirm Azure reports the webhook action as successful and OpsKnight returns HTTP `202`.
3. Trigger the real non-production rule. Confirm one incident appears on the selected service with source `Azure Monitor (<monitor service>)`.
4. Clear the condition. Confirm the existing incident resolves instead of creating another incident.

The Azure test action proves delivery and parsing; only the trigger-and-clear exercise proves correlation.

## Use and event mapping

OpsKnight uses `data.essentials.alertId` (or the legacy context ID) as `azure-<alert-id>`. The rule name becomes the incident summary. `Sev0`, `Sev1`, `Sev2`, and `Sev3`/`Sev4` map to critical, error, warning, and info. Alert context and custom properties remain available as incident details.

Requests must be JSON, are limited to 1 MiB, and are rate-limited per integration to 100 requests per 60 seconds. Azure retries selected transient webhook failures, so keep the same endpoint and alert ID; retries converge on the same incident.

## Rotate, disable, or remove the connection

Create a replacement OpsKnight integration, update the Azure webhook receiver, test it, and only then disable or delete the old integration. Removing the Azure action group from every alert rule stops future delivery.

## Troubleshooting

**Azure cannot reach the endpoint:** confirm public DNS, HTTPS trust, port 443, and proxy routing. Do not expose an internal database or worker service.

**Azure reports 400:** enable the common alert schema and inspect **Settings → Integrations → Failures** for payload validation details.

**Azure reports 401/403:** copy the current complete URL again. A missing, truncated, or rotated integration key is rejected.

**A firing creates a second incident:** compare `data.essentials.alertId` in both deliveries. Different Azure alert instances intentionally have different correlation keys.

**The incident never resolves:** confirm the alert rule is stateful and Azure emitted a payload whose `monitorCondition` changed from `Fired` to `Resolved`.

## Related pages

- [Integration troubleshooting](../../troubleshooting/integrations/webhook-rejected)
- [Incident lifecycle](../../concepts/incidents)
- [Integration failures](../../guides/notifications/inspect-delivery)
