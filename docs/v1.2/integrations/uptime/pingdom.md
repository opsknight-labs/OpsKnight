---
order: 2
title: Pingdom
description: Integrate Pingdom alerts with OpsKnight.
---

# Pingdom Integration

Receive down/up alerts from Pingdom.

---

## Endpoint

```
POST /api/integrations/pingdom?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. In OpsKnight, go to **Service -> Integrations**.
2. Add a **Pingdom** integration.
3. Copy the **Webhook URL**:
   `https://[YOUR_DOMAIN]/api/integrations/pingdom?integrationId=[ID]`

### Step 2: Configure Pingdom

1. Go to **Settings -> Integrations**.
2. Add a new **Webhook** integration.
3. Name: OpsKnight
4. URL: Paste the OpsKnight Webhook URL.
5. Enable the webhook for your Checks.

---

## Event Mapping

| Pingdom State     | OpsKnight Action | Urgency    |
| ----------------- | ---------------- | ---------- |
| `Down`            | Trigger          | `critical` |
| `Up` / `Resolved` | Resolve          | -          |

The integration handles both legacy and new Pingdom webhook formats.
