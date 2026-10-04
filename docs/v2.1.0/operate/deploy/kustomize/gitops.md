---
title: Operate OpsKnight through GitOps
description: Promote Kustomize overlays safely with explicit migration ordering, secret ownership, drift control, validation, and rollback.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [GitOps, Kustomize promotion, sync waves]
reader:
  status: READER_COMPLETE
  task: Configure a safe GitOps promotion and migration workflow for OpsKnight.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/kustomize/]
---

# Operate OpsKnight through GitOps

## Prerequisites

Use a controller that supports ordered synchronization or hooks, a protected secret controller, server-side validation, policy checks, and auditable environment promotion.

## Prepare GitOps ownership

Define owners for namespace/resources, Secrets, database migration Job, workloads, ingress/policy, and monitoring. Prevent multiple controllers from writing the same field. Remove placeholder Secrets and keep plaintext credentials outside Git.

Separate the one-shot migration from continuously reconciled Deployments. Use the controller's supported hook/sync-wave semantics or an external release job so migration succeeds before workload revision changes.

## Deploy a revision

1. Render the exact overlay in CI.
2. Run server-side dry-run and policy checks.
3. Review resource/image/topology diff.
4. Reconcile Secret dependencies.
5. Run and verify one-shot migration.
6. Sync workload resources.
7. Wait for role rollouts and execute acceptance.

## Verify promotion

Confirm controller health/no unexpected drift, migration success, exact image, exclusive topology, readiness, role/queue progress, public routing, and synthetic incident lifecycle. Record the Git revision and evidence.

## Operate it in production

Alert on reconciliation failure, unexpected prune, drift, hook failure, and unhealthy workloads. Pause automated promotion when migration or acceptance fails. Avoid live edits; encode durable fixes in the overlay.

## Troubleshooting

**Deployments sync before migration:** correct wave/hook ownership and stop promotion; do not rely on retry timing.

**Secret controller is late:** add explicit health/dependency gating and keep workloads blocked until keys exist.

**Controller prunes migration evidence:** export logs/status to the release record before cleanup.

**Rollback commit is unsafe after migration:** use schema-compatible rollback rules; Git reversal cannot reverse database state.

## Change or undo a revision

Follow [Rollback](../../upgrades/rollback). Revert manifests only when the prior image is compatible with the migrated schema; otherwise execute controlled data recovery. Record and fix the promotion-gate gap.

## Next steps

- [Kustomize troubleshooting](./troubleshooting)
- [Kubernetes production checklist](../kubernetes/production-checklist)

