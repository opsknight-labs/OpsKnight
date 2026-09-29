---
title: Plan a production installation
description: Choose and validate an OpsKnight deployment topology.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [production install, choose deployment, Docker Compose, Kubernetes, Swarm, high availability]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - deploy/compose/
    - deploy/kubernetes/
    - deploy/swarm/
---

# Plan a production installation

Choose from operational ownership, HA, and isolation requirements. No topology
currently has a certified numeric production envelope, so do not choose from an
uncertified requests-per-second claim.

## Choose a topology

- Single host and simplest operation: [Integrated Compose](../operate/deploy/docker-compose/integrated).
- Single host with worker isolation: [Split Compose](../operate/deploy/docker-compose/split).
- Split runtime with web/database connection pressure: calculate the connection
  budget, then add supported PgBouncer transaction pooling.
- Docker-native multi-node HA: [Docker Swarm](../operate/deploy/swarm/).
- Existing Kubernetes platform: [Kubernetes](../operate/deploy/kubernetes/).
- Packaged, schema-validated Kubernetes: [Helm](../operate/deploy/helm/).
- GitOps or owned overlays: [Kustomize](../operate/deploy/kustomize/).

Start with the [deployment landing page](../operate/deploy/) for the current decision and acceptance path.

Use the complete [deployment decision table](../operate/capacity/choose-deployment/)
and [capacity methodology](../operate/capacity/certification-methodology/) before
converting test observations into a production plan.

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
7. Establish queue, provider, PostgreSQL, SSE, and projector alerts from
   [scaling signals](../operate/capacity/scaling-signals/).
