---
title: PagerDuty Events API v2 ingest
description: Ingest adapter for Events API v2 payloads. Change the destination URL. Not a PagerDuty product.
version: v1.3
---

# PagerDuty Events API v2 ingest

OpsKnight can accept the **PagerDuty Events API v2** JSON shape (`trigger`, `acknowledge`, `resolve`) on its own host. That is an ingest adapter: keep the payload, point the URL at OpsKnight. It is not a PagerDuty product, not affiliated with PagerDuty, and not a guarantee that every third-party “PagerDuty integration” will work without testing.

You can often keep existing Alertmanager, Terraform, or script payloads. Confirm against the routes and fields below.

---

## 🎯 Supported Endpoints

OpsKnight accepts PagerDuty v2 events on two routes:

- **Canonical ingest URL**:
  `POST https://your-opsknight.com/api/integrations/pagerduty/v2/enqueue`
- **Short URL**:
  `POST https://your-opsknight.com/api/integrations/pagerduty`

---

## 🔑 Authentication & Routing

OpsKnight accepts the integration routing key in these locations:

1. Root JSON `routing_key` or `routingKey`.
2. `Authorization: Bearer YOUR_INTEGRATION_KEY`.
3. `X-Routing-Key: YOUR_INTEGRATION_KEY`.
4. Query parameter `?key=YOUR_INTEGRATION_KEY` or `?token=YOUR_INTEGRATION_KEY`.

You can instead include `?integrationId=INTEGRATION_ID`, but the request must still provide the matching key in one of the supported locations above. `Authorization: Token token=…` and a `routing_key` query parameter are not accepted by the current v1.3 route.

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
- `401 Unauthorized`: An `integrationId` was supplied but its matching key was missing or invalid.
- `404 Not Found`: No enabled integration matched the supplied ID or routing key.
- `429 Too Many Requests`: Rate limit exceeded for this integration key (returns `Retry-After` header).
