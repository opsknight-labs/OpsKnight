---
title: Configure PgBouncer with Helm
description: Enable Web-only PgBouncer transaction pooling for split Helm deployments while retaining direct role connections.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Helm PgBouncer, transaction pooling]
reader:
  status: READER_COMPLETE
  task: Configure and validate PgBouncer in split Helm runtime.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/helm/opsknight/templates/pgbouncer-deployment.yaml, deploy/kubernetes/helm/opsknight/values.yaml]
---

# Configure PgBouncer with Helm

## Prerequisites

Use `runtime.mode: split`, calculate the backend connection budget, and configure a direct database path for migration and non-Web roles.

## Prepare the configuration

Enable `pgbouncer`, set reviewed client/backend pool limits, supply credentials through the existing Secret, and configure private CA verification when required. Web receives the pooled URL; migration, Scheduler, workers, and Status Projector retain direct URLs.

## Deploy PgBouncer

Lint/render and inspect PgBouncer Deployment, Service, Secret references, NetworkPolicy, PDB, and Web database environment. Ensure the migration Job never targets port `6432`. Install/upgrade and watch PgBouncer plus Web readiness.

## Verify pooling

Confirm the migration hook succeeds directly, PgBouncer and Web are Ready, and a synthetic incident completes. Observe client wait, backend pool use, PostgreSQL connections, and Web readiness under representative traffic.

## Operate it in production

Alert on client wait, server-pool saturation, TLS/auth failure, restarts, and direct database exhaustion. Keep reserve for migrations, workers, monitoring, and emergency access.

## Troubleshooting

**PgBouncer Pod fails:** inspect structured endpoint/credentials, Secret keys, DNS/network, TLS CA, and configuration logs.

**Migration fails with pooling enabled:** correct the Job's direct URL; never migrate through transaction pooling.

**Clients wait despite high client limit:** backend/database capacity is exhausted; tune the backend pool or database rather than only increasing clients.

## Change or remove PgBouncer

First validate the direct Web connection budget, update Web to direct PostgreSQL, roll and verify it, then disable PgBouncer. Do not remove the Service while Web still targets it.

## Next steps

- [Install with Helm](./install)
- [Helm troubleshooting](./troubleshooting)

