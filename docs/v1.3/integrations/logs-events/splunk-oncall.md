---
order: 2
title: Splunk On-Call (VictorOps)
description: Migrate alerts from Splunk On-Call to OpsKnight.
---

# Splunk On-Call Integration

Receive outgoing webhooks from Splunk On-Call.

---

## Endpoint

```
POST /api/integrations/splunk-oncall?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. In OpsKnight, go to **Service -> Integrations**.
2. Add a **Splunk On-Call** integration.
3. Copy the **Webhook URL**:
   `https://[YOUR_DOMAIN]/api/integrations/splunk-oncall?integrationId=[ID]`

### Step 2: Configure Splunk On-Call

1. Go to **Integrations -> Outgoing Webhooks**.
2. Add the OpsKnight Webhook URL.
