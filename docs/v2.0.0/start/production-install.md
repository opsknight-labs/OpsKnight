---
title: Plan a production installation
description: Choose and validate an OpsKnight deployment topology.
type: deployment
product_area: deployment
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - deploy/compose/
    - deploy/kubernetes/
    - deploy/swarm/
---

# Plan a production installation

Choose a topology based on failure isolation, throughput, and operational
ownership. The deployment reference covers Compose, Kubernetes, Helm,
Kustomize, and split-runtime roles. Do not promote an installation until
readiness, migrations, backup, restore, and rollback have been exercised.

## Choose a topology

- Use [Compose](../operate/deploy/compose) for a single-host installation with
  straightforward ownership.
- Use [Kubernetes](../operate/deploy/kubernetes) when the platform team owns
  scheduling, disruption budgets, network policy, and persistent storage.
- Use [split runtime](../operate/deploy/split-runtime) when web, scheduler,
  critical, general, bulk, and status projection workloads need independent
  capacity and failure isolation.

## Promotion checklist

1. Pin images by immutable tag or digest and run migrations as a one-shot step.
2. Store database, authentication, encryption, provider, and signing secrets in
   the platform secret store.
3. Configure TLS, public URLs, outbound policy, and least-privilege database
   access.
4. Validate liveness, readiness, metrics authentication, worker health, and
   scheduler ownership.
5. Exercise [backup and restore](../operate/data/backup-and-restore), an upgrade,
   and [rollback](../operate/upgrades/rollback) with representative data.
6. Run a synthetic incident through every delivery channel before accepting
   production alerts.
