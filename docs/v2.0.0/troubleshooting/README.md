---
title: Troubleshooting
order: 7
description: Diagnose OpsKnight symptoms using observable evidence.
type: concept
product_area: operations
audience: [operator, administrator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/app/api/health/deep/route.ts, deploy/]
---

# Troubleshooting

Troubleshooting is organized by symptom rather than component internals. Each
page must identify observable signals, safe diagnostic steps, likely causes,
recovery actions, and escalation evidence.

Choose the symptom area:

- [Installation](./installation/)
- [Login and access](./login/)
- [Notification delivery](./notifications/)
- [Incident processing](./incidents/)
- [Inbound integrations](./integrations/)
- [Status pages](./status-pages/)
- [Workers](./workers/)
- [Scheduler](./scheduler/)
- [Database and PgBouncer](./database/)
- [Kubernetes](./kubernetes/)
- [Upgrades and migrations](./upgrades/)
