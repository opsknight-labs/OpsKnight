---
order: 3
title: Google Cloud Monitoring
description: Integrate Google Cloud Monitoring with OpsKnight.
---

# Google Cloud Monitoring Integration

Receive alerts from GCP in OpsKnight.

---

## Endpoint

```
POST /api/integrations/google-cloud-monitoring?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. In OpsKnight, go to **Service -> Integrations**.
2. Add a **Google Cloud Monitoring** integration.
3. Copy the **Webhook URL**:
   `https://[YOUR_DOMAIN]/api/integrations/google-cloud-monitoring?integrationId=[ID]`

### Step 2: Configure Google Cloud Monitoring

1. Go to **Monitoring -> Alerting -> Edit Notification Channels**.
2. Scroll to **Webhooks** and click **Add New**.
3. Enter the OpsKnight Webhook URL.
4. Save the channel and add it to your Alert Policies.
