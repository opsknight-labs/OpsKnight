---
title: Deploy OpsKnight with Docker Compose
description: Choose and follow a complete single-host OpsKnight installation path using maintained Compose files.
type: concept
product_area: deployment
audience: [operator, administrator]
keywords: [Docker Compose, single host, integrated, split]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - deploy/compose/
---

# Deploy OpsKnight with Docker Compose

Docker Compose is the maintained single-host path. It supports integrated or split runtime, bundled or external PostgreSQL, and split-mode PgBouncer.

## Choose an installation

- Start with [Prerequisites](./prerequisites).
- Choose [Integrated runtime](./integrated) for the simplest small installation.
- Choose [Split runtime](./split) for isolated runtime roles and role-specific scaling.
- Add [External PostgreSQL](./external-postgres) when the database is operator-managed.
- Add [PgBouncer](./pgbouncer) only to a supported split topology.
- Put the application behind a [TLS reverse proxy](./reverse-proxy).

Use the same ordered Compose file list for every command. Store that list in the deployment runbook. Omitting or reordering an overlay can start the wrong ownership model.

## Lifecycle guides

- [Upgrade a Compose deployment](./upgrade)
- [Troubleshoot Compose](./troubleshooting)
- [Production acceptance checklist](./production-checklist)
- [Back up and restore](../../data/backup-and-restore)

## Scope and availability

Compose persists state across container replacement, but it does not reschedule workloads onto another host. Host failure remains an outage until the host or deployment is recovered. Choose [Swarm](../swarm/) or [Kubernetes](../kubernetes/) when automatic multi-node rescheduling is required.

