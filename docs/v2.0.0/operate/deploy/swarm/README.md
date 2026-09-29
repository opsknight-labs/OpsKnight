---
title: Install OpsKnight on Docker Swarm
description: Follow the maintained script-driven path for multi-node OpsKnight on Docker Swarm.
type: concept
product_area: deployment
audience: [operator, administrator]
keywords: [Docker Swarm, multi-node, deployment]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/swarm/]
---

# Install OpsKnight on Docker Swarm

Use Swarm when it is already your production scheduler and OpsKnight must run across Docker hosts. Swarm can replace application tasks; it does not make bundled PostgreSQL highly available.

## Installation path

1. Complete [Swarm prerequisites](./prerequisites).
2. Choose integrated/split and bundled/external database in [topology and database](./topology-and-database).
3. Follow the script-driven [installation](./install).
4. Complete the [production checklist](./production-checklist).
5. Use [upgrade and rollback](./upgrade) and [troubleshooting](./troubleshooting).

Use external HA PostgreSQL, an external TLS load balancer, durable backups, and at least three managers for a production HA objective.

