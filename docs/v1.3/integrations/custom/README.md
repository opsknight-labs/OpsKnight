---
order: 8
title: Custom Integrations
description: Webhooks, generic JSON adapters, and PagerDuty emulation endpoints.
---

# Custom Integrations

Connect custom scripts, internal microservices, or proprietary alerting systems into OpsKnight using generic webhooks or drop-in emulation endpoints.

## Available Integrations

<!-- integrations-list:start -->

- [Generic Webhooks](./custom/webhooks) — Receive alerts from any external system via customizable JSON payloads and HMAC signatures.
- [PagerDuty Emulation (Events API v2)](./custom/pagerduty-emulation) — Drop-in replacement for PagerDuty Events API v2 (`/api/integrations/pagerduty` and `/api/events/v2`). Connect any tool with native PagerDuty support with 0 code changes.
<!-- integrations-list:end -->

---

## Capabilities Comparison

| Integration | Endpoint | Supported Actions | Authentication |
| :--- | :--- | :--- | :--- |
| **Generic Webhooks** | `/api/integrations/webhook` | `trigger`, `resolve` | Routing Key, HMAC Signature |
| **PagerDuty Emulation** | `/api/integrations/pagerduty` | `trigger`, `acknowledge`, `resolve` | `routing_key` payload or header |
| **Events API** | `/api/events` | `trigger`, `acknowledge`, `resolve` | API Token, Routing Key |
