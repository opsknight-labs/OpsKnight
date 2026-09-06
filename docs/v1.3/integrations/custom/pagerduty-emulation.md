---
title: PagerDuty Events API v2 Emulation
description: Drop-in compatible PagerDuty Events API v2 endpoint for seamless tool migration.
version: v1.3
---

# PagerDuty Events API v2 Emulation

OpsKnight provides native, drop-in compatibility with the standard **PagerDuty Events API v2**.

This allows you to point existing monitoring agents, Terraform providers, Prometheus AlertManager configs, or custom scripts originally designed for PagerDuty directly to OpsKnight without changing your payload schemas.

---

## 🎯 Supported Endpoints

OpsKnight accepts PagerDuty v2 events on two routes:

- **Canonical Emulation URL**:
  `POST https://your-opsknight.com/api/integrations/pagerduty/v2/enqueue`
- **Short URL**:
  `POST https://your-opsknight.com/api/integrations/pagerduty`

---

## 🔑 Authentication & Routing

OpsKnight supports all standard PagerDuty routing key locations:

1. **`routing_key` inside Payload**: Included in the root JSON payload body.
2. **`Authorization: Token token=...` Header**: Standard PagerDuty authentication header format.
3. **`x-routing-key` Header**: Direct custom header.
4. **URL Query Param**: `?routing_key=YOUR_INTEGRATION_KEY` or `?key=YOUR_INTEGRATION_KEY`.

---

## 📥 Supported Actions & Schemas

### 1. Trigger Incident

```bash
curl -X POST https://your-opsknight.com/api/integrations/pagerduty/v2/enqueue \
  -H "Content-Type: application/json" \
  -d '{
    "routing_key": "YOUR_INTEGRATION_KEY",
    "event_action": "trigger",
    "dedup_key": "disk-usage-srv-01",
    "payload": {
      "summary": "Disk usage exceeded 95% on /dev/sda1",
      "source": "srv-01.prod.internal",
      "severity": "critical",
      "component": "storage",
      "group": "infra-prod",
      "class": "disk-full",
      "custom_details": {
        "free_space_mb": 512,
        "mount_point": "/var/log"
      }
    },
    "links": [
      {
        "href": "https://grafana.company.com/d/storage-overview",
        "text": "Grafana Storage Dashboard"
      }
    ]
  }'
```

### 2. Acknowledge Incident

```bash
curl -X POST https://your-opsknight.com/api/integrations/pagerduty/v2/enqueue \
  -H "Content-Type: application/json" \
  -d '{
    "routing_key": "YOUR_INTEGRATION_KEY",
    "event_action": "acknowledge",
    "dedup_key": "disk-usage-srv-01"
  }'
```

### 3. Resolve Incident

```bash
curl -X POST https://your-opsknight.com/api/integrations/pagerduty/v2/enqueue \
  -H "Content-Type: application/json" \
  -d '{
    "routing_key": "YOUR_INTEGRATION_KEY",
    "event_action": "resolve",
    "dedup_key": "disk-usage-srv-01"
  }'
```

---

## ⚡ Response Codes

- `202 Accepted`: Event successfully parsed, validated, and queued into the incident pipeline.
  ```json
  {
    "status": "success",
    "message": "Event processed",
    "dedup_key": "disk-usage-srv-01"
  }
  ```
- `400 Bad Request`: Payload validation error (e.g. missing summary or invalid severity).
- `401 / 404 Not Found`: Invalid or disabled integration routing key.
- `429 Too Many Requests`: Rate limit exceeded for this integration key (returns `Retry-After` header).
