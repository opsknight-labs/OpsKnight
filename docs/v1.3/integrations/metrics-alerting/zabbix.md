---
title: Zabbix Integration Guide
description: Configure Zabbix Webhook Media Types to trigger and auto-resolve OpsKnight incidents.
version: v1.3
---

# Zabbix Integration Guide

OpsKnight provides native, first-class support for **Zabbix 5.x, 6.x, and 7.x** through configurable Webhook Media Types.

---

## 🎯 Key Capabilities

- **Automatic Problem & Recovery Sync**: `PROBLEM` events trigger incidents in OpsKnight; recovery events (`RESOLVED`, `OK`) automatically resolve the active incident using the original Zabbix `EVENT.ID`.
- **6-Level Severity Mapping**:
  - `Disaster` (5) $\to$ **Critical**
  - `High` (4) $\to$ **Error**
  - `Average` (3) / `Warning` (2) $\to$ **Warning**
  - `Information` (1) / `Not classified` (0) $\to$ **Info**
- **Rich Context Ingestion**: Extracts host name, host IP, item key, trigger name, event tags, operational data, and direct web links to the Zabbix UI.
- **Timing-Safe Authentication**: Authenticates incoming payloads using integration keys passed via HTTP header or query parameter.

---

## 🚀 Setup Instructions

### 1. Obtain Your OpsKnight Webhook URL

1. In OpsKnight, navigate to **Services** $\to$ select your target service $\to$ **Integrations** tab.
2. Click **Add Integration** and select **Zabbix**.
3. Copy your unique **Webhook URL** and **Integration Key**.

```
https://your-opsknight-instance.com/api/integrations/zabbix?integrationId=YOUR_INTEGRATION_ID&integrationKey=YOUR_INTEGRATION_KEY
```

---

### 2. Create a Media Type in Zabbix

1. In the Zabbix Web UI, go to **Alerts** $\to$ **Media types** (or **Administration** $\to$ **Media types** in Zabbix 5.x).
2. Click **Create media type** in the top right.
3. Configure the media type parameters:
   - **Name**: `OpsKnight Webhook`
   - **Type**: `Webhook`
   - **Parameters**: Add the following parameter keys and values:

| Parameter Key | Value (Zabbix Macro) |
| :--- | :--- |
| `event_id` | `{EVENT.ID}` |
| `event_name` | `{EVENT.NAME}` |
| `event_severity` | `{EVENT.SEVERITY}` |
| `event_status` | `{EVENT.STATUS}` |
| `event_value` | `{EVENT.VALUE}` |
| `trigger_id` | `{TRIGGER.ID}` |
| `trigger_description` | `{TRIGGER.DESCRIPTION}` |
| `host_name` | `{HOST.NAME}` |
| `host_ip` | `{HOST.IP}` |
| `item_name` | `{ITEM.NAME}` |
| `item_key` | `{ITEM.KEY}` |
| `item_value` | `{ITEM.VALUE}` |
| `event_tags` | `{EVENT.TAGS}` |
| `event_url` | `{$ZABBIX.URL}/tr_events.php?triggerid={TRIGGER.ID}&eventid={EVENT.ID}` |
| `integration_url` | `<PASTE YOUR OPSKNIGHT WEBHOOK URL HERE>` |

4. **Script**: Paste the following JavaScript handler into the **Script** text area:

```javascript
try {
    Zabbix.log(4, '[OpsKnight Webhook] Processing alert: ' + value);

    var params = JSON.parse(value);
    var req = new HttpRequest();

    req.addHeader('Content-Type: application/json');

    var payload = {
        event_id: params.event_id,
        event_name: params.event_name,
        event_severity: params.event_severity,
        event_status: params.event_status,
        event_value: params.event_value,
        trigger_id: params.trigger_id,
        trigger_description: params.trigger_description,
        host_name: params.host_name,
        host_ip: params.host_ip,
        item_name: params.item_name,
        item_key: params.item_key,
        item_value: params.item_value,
        event_tags: params.event_tags,
        event_url: params.event_url
    };

    var response = req.post(params.integration_url, JSON.stringify(payload));

    if (req.getStatus() !== 200 && req.getStatus() !== 202) {
        throw 'Request failed with status code ' + req.getStatus() + ': ' + response;
    }

    return 'OK';
} catch (error) {
    Zabbix.log(3, '[OpsKnight Webhook] Notification failed: ' + error);
    throw 'OpsKnight notification failed: ' + error;
}
```

5. Click **Add** or **Update** to save the media type.

---

### 3. Assign Media to Users & Actions

1. In Zabbix, go to **Users** $\to$ select your Admin / Alerting User $\to$ **Media** tab.
2. Add the **OpsKnight Webhook** media type and save.
3. In **Alerts** $\to$ **Actions** $\to$ **Trigger actions**:
   - Ensure an active action exists that sends operations, recovery operations, and update operations to the user or user group with OpsKnight media.

---

## 🔍 Payload Specification

OpsKnight accepts JSON payloads matching this schema:

```json
{
  "event_id": "10042",
  "event_name": "High CPU utilization on prod-web-01 (>90%)",
  "event_severity": "4",
  "event_status": "PROBLEM",
  "event_value": "1",
  "trigger_id": "18492",
  "host_name": "prod-web-01",
  "host_ip": "10.0.4.12",
  "item_name": "CPU utilization percentage",
  "item_key": "system.cpu.util[,idle]",
  "item_value": "94.2%",
  "event_tags": "Environment:Production,Tier:Frontend",
  "event_url": "https://zabbix.company.com/tr_events.php?triggerid=18492&eventid=10042"
}
```

---

## 🛠️ Troubleshooting

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| `HTTP 401 Unauthorized` | Invalid or missing integration key | Verify the `integrationKey` query parameter or `x-integration-key` header matches the key in OpsKnight. |
| `HTTP 400 Bad Request` | Missing required fields | Ensure the media type script passes valid JSON and at least `event_name` or `trigger_description`. |
| Recovery not closing incident | `event_id` missing | Verify `{EVENT.ID}` is mapped in parameters so OpsKnight matches the deduplication key. |
