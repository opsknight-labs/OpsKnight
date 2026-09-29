---
title: Complete an OpsKnight Kustomize installation
description: Create an overlay, provision secrets, run one-shot migration, apply workloads, and validate OpsKnight.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Kustomize install, migration job, overlay]
reader:
  status: READER_COMPLETE
  task: Install and validate OpsKnight from zero with Kustomize.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/kustomize/]
---

# Complete an OpsKnight Kustomize installation

## Prerequisites

Complete [Kubernetes prerequisites](../kubernetes/prerequisites), secrets, database, ingress, and NetworkPolicy planning. Choose a maintained profile and immutable image digest.

## Prepare the overlay

Create an environment overlay that references exactly one profile. Patch the image digest, public URLs, ingress/TLS, database/storage, policy, replicas/resources, probes, PDBs, and topology spread. Delete the placeholder Secret; make the secret controller create the expected keys.

```sh
kubectl kustomize deploy/environments/production > rendered.yaml
kubectl apply --server-side --dry-run=server -f rendered.yaml
```

Reject placeholder values, mutable images, integrated-plus-split ownership, public PostgreSQL, broad unintended egress, or missing operational resources.

## Run migration and deploy

Create a one-shot Job from the target image using `DIRECT_DATABASE_URL`. Run Prisma deploy plus the maintained release index installers documented in [Database migrations](../../upgrades/database-migrations). Do not include an ordinary Job in continuously reconciled resources without controller-specific one-shot ordering.

```sh
kubectl apply -f migration-job.yaml
kubectl -n opsknight wait --for=condition=complete job/opsknight-migration --timeout=15m
kubectl -n opsknight logs job/opsknight-migration
kubectl apply -k deploy/environments/production
```

Stop if migration fails.

## Verify the installation

Confirm only the chosen topology, all selected Pods Ready, public readiness, current role heartbeats/queues, and expected ingress/policy. Open `/setup`, create the administrator and service, then run a synthetic incident through notification, acknowledgement, resolution, and status projection.

## Operate it in production

Promote reviewed overlay revisions, keep migration ordering explicit, monitor drift and role/database/provider signals, and complete the Kubernetes production checklist. Never edit live objects as the durable fix; commit the overlay correction.

## Troubleshooting

**Render fails:** inspect resource identity, patch target, YAML type, and referenced path.

**Migration fails:** keep workload revision unapplied; inspect direct database/TLS/privileges and exact migration command.

**Apply prunes required resources:** compare rendered inventories and GitOps ownership before another sync.

**Ready Pods but workflow fails:** inspect role ownership, queues/providers, database routes, and public proxy rather than only readiness.

## Change or remove the installation

Use reviewed overlay revisions and explicit migration/rollback procedures. Before deletion, take a verified backup and understand PVC/finalizer/prune behavior; removing manifests is not a database backup.

## Next steps

- [GitOps lifecycle](./gitops)
- [Kustomize troubleshooting](./troubleshooting)

