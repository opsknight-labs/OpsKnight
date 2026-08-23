---
order: 8
title: Custom Integrations
description: Webhooks, generic JSON adapters, and Events API v2 ingest.
---

# Custom Integrations

Connect custom scripts, internal microservices, or proprietary alerting systems into OpsKnight using generic webhooks or an Events API v2 ingest adapter.

## Available Integrations

<!-- integrations-list:start -->

- [Generic Webhooks](./webhooks) — Receive alerts from any external system via customizable JSON payloads and HMAC signatures.
- [PagerDuty Events API v2 ingest](./pagerduty-emulation) — Accept Events API v2 payloads at `/api/integrations/pagerduty` (and related routes). Change the destination URL; test your tool. Not affiliated with PagerDuty.

<!-- integrations-list:end -->

---

## Capabilities Comparison

| Integration              | Endpoint                      | Supported Actions                   | Authentication                                                    |
| :----------------------- | :---------------------------- | :---------------------------------- | :---------------------------------------------------------------- |
| **Generic Webhooks**     | `/api/integrations/webhook`   | `trigger`, `resolve`                | Routing Key, HMAC Signature                                       |
| **Events API v2 ingest** | `/api/integrations/pagerduty` | `trigger`, `acknowledge`, `resolve` | `routing_key` payload, Bearer, `X-Routing-Key`, `key`, or `token` |
| **Events API**           | `/api/events`                 | `trigger`, `acknowledge`, `resolve` | API Token, Routing Key                                            |
