---
title: Integrations
order: 4
description: Connect monitoring, cloud, communication, issue-tracking, uptime, and webhook systems.
type: integration
product_area: integrations
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [docs/v2.0.0/integrations/catalog.yaml, src/app/api/integrations/]
---

# Integrations

The machine-readable [catalog](./catalog.yaml) includes inbound alert adapters,
Slack, Microsoft Teams, Jira, outbound webhooks, notification delivery, OIDC,
and SCIM. Inbound provider pages are generated from source-derived contracts;
the communication and identity pages are maintained as workflow documentation.

Each inbound page records the handler type, lifecycle actions actually present
in its adapter, authentication and conditional signature behavior, and available
delivery identity. Do not assume every provider supports acknowledge, signatures,
or durable delivery fencing merely because another provider does.
