---
order: 3
title: Dynatrace
description: Integrate Dynatrace problems with OpsKnight.
---

# Dynatrace Integration

Receive problem notifications from Dynatrace.

---

## Endpoint

```
POST /api/integrations/dynatrace?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. Go to **Service -> Integrations**.
2. Add a **Dynatrace** integration.
3. Copy the **Webhook URL**:
   `https://[YOUR_DOMAIN]/api/integrations/dynatrace?integrationId=[ID]`

### Step 2: Configure Dynatrace

1. Go to **Settings -> Integration -> Problem Notifications**.
2. Select **Custom Integration**.
3. Name: OpsKnight.
4. Webhook URL: Paste the OpsKnight Webhook URL.
5. Save and Test.
