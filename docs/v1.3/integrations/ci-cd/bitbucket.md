---
order: 2
title: Bitbucket
description: Receive Bitbucket Pipeline failure alerts in OpsKnight.
---

# Bitbucket Integration

Monitor Bitbucket Pipelines and receive alerts for build failures.

---

## Endpoint

```
POST /api/integrations/bitbucket?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. In OpsKnight, go to **Service -> Integrations**.
2. Add a **Bitbucket** integration.
3. Copy the **Webhook URL**:
   `https://[YOUR_DOMAIN]/api/integrations/bitbucket?integrationId=[ID]`

### Step 2: Configure Bitbucket

1. Go to Repository **Settings -> Webhooks**.
2. Click **Add webhook**.
3. URL: Paste the OpsKnight Webhook URL.
4. Triggers: Select **Build status created** and **Build status updated**.
5. Save.
