---
order: 8
title: Splunk Observability
description: Integrate Splunk (SignalFx) detectors.
---

# Splunk Observability Integration

Receive detector alerts from Splunk Observability Cloud.

---

## Endpoint

```
POST /api/integrations/splunk-observability?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. In OpsKnight, go to **Service -> Integrations**.
2. Add a **Splunk Observability** integration.
3. Copy the **Webhook URL**:
   `https://[YOUR_DOMAIN]/api/integrations/splunk-observability?integrationId=[ID]`

### Step 2: Configure Splunk Observability

1. Go to **Settings -> Integrations**.
2. Create a **Webhook** integration.
3. Name: OpsKnight.
4. URL: Paste the OpsKnight Webhook URL.

---

## Event Mapping

The integration automatically parses the webhook payload:

- **Title**: Uses detector name or alert title.
- **Link**: Extracts deep link to the Splunk chart (`link`).
- **Deduplication**: Uses `incidentId` or `detectorId`.
- **Status**: Maps `status` (e.g., 'Active', 'Cleared') -> Trigger/Resolution.
